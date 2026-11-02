import AppKit
import Network
import ServiceManagement
import UserNotifications
import WebKit

let homeURL = URL(string: "https://www.messenger.com/")!

/// Hosts that stay inside the app. Everything else opens in the default browser.
let internalDomains = ["messenger.com", "facebook.com", "facebook.net", "fbcdn.net", "fbsbx.com", "meta.com"]

func isInternalHost(_ host: String?) -> Bool {
    guard let host = host?.lowercased() else { return false }
    return internalDomains.contains { host == $0 || host.hasSuffix("." + $0) }
}

func isInternal(_ url: URL) -> Bool {
    switch url.scheme?.lowercased() {
    case "http", "https": return isInternalHost(url.host)
    case "about", "blob", "data": return true
    default: return false
    }
}

/// Unwraps Meta's outbound link shim (l.messenger.com/l.php?u=…) to the real destination.
func unwrapLinkShim(_ url: URL) -> URL {
    guard let host = url.host?.lowercased(), host.hasPrefix("l.") || host.hasPrefix("lm."),
          url.path == "/l.php",
          let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?
              .queryItems?.first(where: { $0.name == "u" })?.value,
          let targetURL = URL(string: target)
    else { return url }
    return targetURL
}

enum Pref {
    static let notifications = "notificationsEnabled"
    static let sound = "notificationSound"
    static let previews = "notificationPreviews"
    static let zoom = "pageZoom"
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {

    private var window: NSWindow!
    private var webView: WKWebView!
    private var popups: [PopupWindow] = []
    private var titleObservation: NSKeyValueObservation?
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var showingErrorPage = false
    private var retryTimer: Timer?
    private var activity: NSObjectProtocol?
    private let pathMonitor = NWPathMonitor()
    private let notifications = NotificationRouter()
    private let defaults = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        defaults.register(defaults: [
            Pref.notifications: true, Pref.sound: true, Pref.previews: true, Pref.zoom: 1.0,
        ])
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.mainMenu = buildMainMenu()
        buildWindow()

        notifications.onClick = { [weak self] id in self?.notificationClicked(id) }
        notifications.isWindowOnScreen = { [weak self] in
            guard let window = self?.window else { return false }
            return window.isVisible && !window.isMiniaturized
        }
        notifications.requestAuthorization()

        // Keep the app out of App Nap so messages and notifications land instantly while hidden.
        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep], reason: "Receive messages in real time")

        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.retryIfShowingError() }
        }
        pathMonitor.start(queue: .main)

        loadHome()
        showMainWindow()
    }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        // Cmd-Tabbing back after Cmd-W should bring the window back, like clicking the Dock icon.
        if !window.isVisible && !popups.contains(where: { $0.window.isVisible }) {
            showMainWindow()
        }
    }

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "Version/\(safariVersion()) Safari/605.1.15"
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.isElementFullscreenEnabled = true
        // Never throttle or suspend the page when the window is hidden or in the background.
        config.preferences.inactiveSchedulingPolicy = .none

        let controller = config.userContentController
        controller.add(self, name: "native")
        if let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true
        webView.pageZoom = defaults.double(forKey: Pref.zoom)
        webView.setValue(false, forKey: "drawsBackground") // no white flash in dark mode

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Messenger"
        window.minSize = NSSize(width: 420, height: 400)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.delegate = self
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MainWindow")

        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] webView, _ in
            MainActor.assumeIsolated { self?.updateBadge(from: webView.title) }
        }
    }

    private func safariVersion() -> String {
        Bundle(path: "/Applications/Safari.app")?.infoDictionary?["CFBundleShortVersionString"] as? String ?? "26.0"
    }

    @objc func showMainWindow() {
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func loadHome() {
        showingErrorPage = false
        retryTimer?.invalidate()
        webView.load(URLRequest(url: homeURL))
    }

    private func retryIfShowingError() {
        if showingErrorPage { loadHome() }
    }

    private func updateBadge(from title: String?) {
        let title = title ?? ""
        if let match = title.firstMatch(of: #/^\((\d+)\)/#) {
            NSApp.dockTile.badgeLabel = String(match.1)
        } else if title.hasPrefix("Messenger") || title.hasPrefix("Facebook") {
            NSApp.dockTile.badgeLabel = nil
        }
        // Other titles ("Alex sent a message") are transient, so keep the current badge.
    }

    private var activeWebView: WKWebView {
        popups.first(where: { $0.window.isKeyWindow })?.webView ?? webView
    }

    private func runJS(_ body: String) {
        webView.callAsyncJavaScript(body, in: nil, in: .page, completionHandler: nil)
    }

    private func popup(for webView: WKWebView) -> PopupWindow? {
        popups.first { $0.webView === webView }
    }

    func popupDidClose(_ popup: PopupWindow) {
        popups.removeAll { $0 === popup }
    }

    // MARK: Window

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        // Closing only hides the window, so Messenger stays connected and reopens instantly.
        if sender.styleMask.contains(.fullScreen) {
            NSApp.hide(nil)
        } else {
            sender.orderOut(nil)
        }
        return false
    }

    func windowDidBecomeKey(_ notification: Notification) {
        // Everything unread is visible in the sidebar now; clear the stale banners.
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }

    // MARK: Notifications

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "notify": postNotification(body)
        case "retry": loadHome()
        default: break
        }
    }

    private func postNotification(_ body: [String: Any]) {
        guard defaults.bool(forKey: Pref.notifications) else { return }
        let showPreview = defaults.bool(forKey: Pref.previews)
        let icon = (body["icon"] as? String)
            .flatMap { URL(string: $0) }
            .flatMap { ["https", "data"].contains($0.scheme ?? "") ? $0 : nil }
        notifications.post(
            id: body["id"] as? String ?? UUID().uuidString,
            title: showPreview ? (body["title"] as? String ?? "Messenger") : "Messenger",
            body: showPreview ? (body["body"] as? String ?? "") : "New message",
            thread: body["tag"] as? String ?? "",
            iconURL: showPreview ? icon : nil,
            sound: defaults.bool(forKey: Pref.sound) && (body["silent"] as? Bool) != true)
    }

    private func notificationClicked(_ id: String) {
        showMainWindow()
        webView.callAsyncJavaScript(
            "window.__mdeskNotificationClicked?.(id)", arguments: ["id": id], in: nil, in: .page, completionHandler: nil)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let target = unwrapLinkShim(url)
        if isMainFrame && (target != url || !isInternal(url)) {
            NSWorkspace.shared.open(target)
            decisionHandler(.cancel)
            // A popup that was only opened to visit an outside link has nothing left to show.
            if let popup = popup(for: webView), webView.backForwardList.currentItem == nil {
                popup.close()
            }
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if disposition.lowercased().hasPrefix("attachment") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView else { return }
        let error = error as NSError
        let offline = [
            NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
            NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed,
            NSURLErrorInternationalRoamingOff, NSURLErrorDataNotAllowed,
        ]
        guard error.domain == NSURLErrorDomain, offline.contains(error.code) else { return }
        showErrorPage(error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === self.webView {
            if webView.url == nil { loadHome() } else { webView.reload() }
        } else {
            popup(for: webView)?.close()
        }
    }

    private func showErrorPage(_ message: String) {
        showingErrorPage = true
        let escaped = message
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
        let html = """
            <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
            <style>
              body { font: 14px -apple-system, system-ui; display: grid; place-items: center; height: 100vh;
                     margin: 0; color: CanvasText; background: Canvas; -webkit-user-select: none; }
              div { text-align: center; max-width: 340px; }
              h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
              p { color: GrayText; margin: 0 0 20px; line-height: 1.4; }
              button { font: inherit; font-weight: 500; padding: 8px 20px; border-radius: 18px; border: 0;
                       background: #0a7cff; color: white; cursor: pointer; }
            </style>
            <div>
              <h1>Can’t reach Messenger</h1>
              <p>\(escaped)<br>Retrying automatically…</p>
              <button onclick="__mdesk.retry()">Try Again</button>
            </div>
            """
        webView.loadHTMLString(html, baseURL: nil)
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.retryIfShowingError() }
        }
    }

    // MARK: Downloads

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let destination = uniqueFile(in: folder, named: suggestedFilename)
        downloads[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // Bounces the Downloads stack in the Dock, like Safari does.
        DistributedNotificationCenter.default().post(name: .init("com.apple.DownloadFileFinished"), object: file.path)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }

    private func uniqueFile(in folder: URL, named name: String) -> URL {
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var candidate = folder.appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return candidate
    }

    // MARK: UI delegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, !url.absoluteString.isEmpty, url.absoluteString != "about:blank" {
            let target = unwrapLinkShim(url)
            // Calls open as sized popups and stay in the app; ordinary links go to the browser.
            let wantsPopup = windowFeatures.width != nil
                || url.path.localizedCaseInsensitiveContains("call")
                || ["blob", "data"].contains(url.scheme ?? "")
            if target != url || !isInternal(url) || !wantsPopup {
                NSWorkspace.shared.open(target)
                return nil
            }
        }
        let popup = PopupWindow(configuration: configuration, features: windowFeatures, owner: self)
        popups.append(popup)
        return popup.webView
    }

    func webViewDidClose(_ webView: WKWebView) {
        popup(for: webView)?.close()
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(isInternalHost(origin.host) ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        if let window = webView.window, window.isVisible {
            panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        present(alert, over: webView) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert, over: webView) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    private func present(_ alert: NSAlert, over webView: WKWebView,
                         then handler: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: handler)
        } else {
            handler(alert.runModal())
        }
    }

    // MARK: Menu actions

    @objc func reloadPage(_ sender: Any?) {
        if showingErrorPage && activeWebView === webView { loadHome() } else { activeWebView.reload() }
    }

    @objc func forceReload(_ sender: Any?) {
        if showingErrorPage && activeWebView === webView { loadHome() } else { activeWebView.reloadFromOrigin() }
    }

    @objc func zoomIn(_ sender: Any?) { setZoom(webView.pageZoom + 0.1) }
    @objc func zoomOut(_ sender: Any?) { setZoom(webView.pageZoom - 0.1) }
    @objc func actualSize(_ sender: Any?) { setZoom(1) }

    private func setZoom(_ value: CGFloat) {
        let zoom = min(max((value * 10).rounded() / 10, 0.5), 3)
        webView.pageZoom = zoom
        defaults.set(Double(zoom), forKey: Pref.zoom)
    }

    @objc func navigateBack(_ sender: Any?) { activeWebView.goBack() }
    @objc func navigateForward(_ sender: Any?) { activeWebView.goForward() }

    @objc func newMessage(_ sender: Any?) {
        showMainWindow()
        webView.callAsyncJavaScript("return window.__mdesk?.compose() === true", in: nil, in: .page) { [weak self] result in
            guard let self, (try? result.get()) as? Bool != true else { return }
            let current = self.webView.url.flatMap { isInternalHost($0.host) ? $0 : nil } ?? homeURL
            let path = current.host?.contains("facebook.com") == true ? "/messages/new" : "/new"
            self.webView.load(URLRequest(url: URL(string: path, relativeTo: current)!))
        }
    }

    @objc func searchChats(_ sender: Any?) { showMainWindow(); runJS("window.__mdesk?.search()") }
    @objc func nextChat(_ sender: Any?) { runJS("window.__mdesk?.step(1)") }
    @objc func previousChat(_ sender: Any?) { runJS("window.__mdesk?.step(-1)") }
    @objc func jumpToChat(_ sender: NSMenuItem) { runJS("window.__mdesk?.go(\(sender.tag - 1))") }

    @objc func toggleNotifications(_ sender: Any?) { toggle(Pref.notifications) }
    @objc func toggleSound(_ sender: Any?) { toggle(Pref.sound) }
    @objc func togglePreviews(_ sender: Any?) { toggle(Pref.previews) }

    private func toggle(_ key: String) {
        defaults.set(!defaults.bool(forKey: key), forKey: key)
    }

    @objc func toggleOpenAtLogin(_ sender: Any?) {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled { try service.unregister() } else { try service.register() }
        } catch {
            _ = NSAlert(error: error).runModal()
        }
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(toggleNotifications(_:)):
            item.state = defaults.bool(forKey: Pref.notifications) ? .on : .off
        case #selector(toggleSound(_:)):
            item.state = defaults.bool(forKey: Pref.sound) ? .on : .off
            return defaults.bool(forKey: Pref.notifications)
        case #selector(togglePreviews(_:)):
            item.state = defaults.bool(forKey: Pref.previews) ? .on : .off
            return defaults.bool(forKey: Pref.notifications)
        case #selector(toggleOpenAtLogin(_:)):
            item.state = SMAppService.mainApp.status == .enabled ? .on : .off
        case #selector(navigateBack(_:)):
            return activeWebView.canGoBack
        case #selector(navigateForward(_:)):
            return activeWebView.canGoForward
        default:
            break
        }
        return true
    }

    // MARK: Menu bar

    private func buildMainMenu() -> NSMenu {
        let main = NSMenu()

        let app = submenu(in: main, "Messenger")
        app.addItem(withTitle: "About Messenger", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        item(app, "Show Notifications", #selector(toggleNotifications(_:)))
        item(app, "Notification Sound", #selector(toggleSound(_:)))
        item(app, "Show Message Previews", #selector(togglePreviews(_:)))
        item(app, "Open at Login", #selector(toggleOpenAtLogin(_:)))
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Messenger", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
            .keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit Messenger", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let edit = submenu(in: main, "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
            .keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Paste and Match Style", action: #selector(NSTextView.pasteAsPlainText(_:)), keyEquivalent: "v")
            .keyEquivalentModifierMask = [.command, .option, .shift]
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let view = submenu(in: main, "View")
        item(view, "Reload", #selector(reloadPage(_:)), "r")
        item(view, "Force Reload", #selector(forceReload(_:)), "r", [.command, .shift])
        view.addItem(.separator())
        item(view, "Actual Size", #selector(actualSize(_:)), "0")
        item(view, "Zoom In", #selector(zoomIn(_:)), "+")
        item(view, "Zoom In", #selector(zoomIn(_:)), "=", hidden: true)
        item(view, "Zoom Out", #selector(zoomOut(_:)), "-")
        view.addItem(.separator())

        let chats = submenu(in: main, "Chats")
        item(chats, "New Message", #selector(newMessage(_:)), "n")
        item(chats, "Search Chats", #selector(searchChats(_:)), "k")
        chats.addItem(.separator())
        item(chats, "Next Chat", #selector(nextChat(_:)), "\t", [.control])
        item(chats, "Previous Chat", #selector(previousChat(_:)), "\t", [.control, .shift])
        item(chats, "Previous Chat", #selector(previousChat(_:)), "\u{19}", [.control, .shift], hidden: true)
        item(chats, "Next Chat", #selector(nextChat(_:)), arrowKey(NSDownArrowFunctionKey), [.command, .option], hidden: true)
        item(chats, "Previous Chat", #selector(previousChat(_:)), arrowKey(NSUpArrowFunctionKey), [.command, .option], hidden: true)
        for i in 1...9 {
            item(chats, "Chat \(i)", #selector(jumpToChat(_:)), "\(i)", tag: i, hidden: true)
        }
        chats.addItem(.separator())
        item(chats, "Back", #selector(navigateBack(_:)), "[")
        item(chats, "Forward", #selector(navigateForward(_:)), "]")

        let windowMenu = submenu(in: main, "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(.separator())
        item(windowMenu, "Messenger", #selector(showMainWindow), "")
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu

        return main
    }

    private func submenu(in main: NSMenu, _ title: String) -> NSMenu {
        let menu = NSMenu(title: title)
        let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        holder.submenu = menu
        main.addItem(holder)
        return menu
    }

    @discardableResult
    private func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "",
                      _ modifiers: NSEvent.ModifierFlags = .command, tag: Int = 0, hidden: Bool = false) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = self
        item.tag = tag
        if hidden {
            item.isHidden = true
            item.allowsKeyEquivalentWhenHidden = true
        }
        menu.addItem(item)
        return item
    }

    private func arrowKey(_ key: Int) -> String {
        String(Character(UnicodeScalar(UInt32(key))!))
    }
}

// MARK: - Popup windows (calls)

final class PopupWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    let webView: WKWebView
    private weak var owner: AppDelegate?
    private var titleObservation: NSKeyValueObservation?

    init(configuration: WKWebViewConfiguration, features: WKWindowFeatures, owner: AppDelegate) {
        let size = NSSize(
            width: features.width.map { CGFloat($0.doubleValue) } ?? 960,
            height: features.height.map { CGFloat($0.doubleValue) } ?? 720)
        webView = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        webView.navigationDelegate = owner
        webView.uiDelegate = owner
        webView.setValue(false, forKey: "drawsBackground")
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.title = "Messenger"
        window.contentView = webView
        window.center()
        self.owner = owner
        super.init()
        window.delegate = self
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] webView, _ in
            MainActor.assumeIsolated {
                if let title = webView.title, !title.isEmpty { self?.window.title = title }
            }
        }
        window.makeKeyAndOrderFront(nil)
    }

    func close() {
        window.close()
    }

    func windowWillClose(_ notification: Notification) {
        // Tear the page down right away so a call's camera and microphone stop with the window.
        titleObservation = nil
        webView.pauseAllMediaPlayback()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.load(URLRequest(url: URL(string: "about:blank")!))
        owner?.popupDidClose(self)
    }
}

// MARK: - Native notifications

final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    var onClick: ((String) -> Void)?
    var isWindowOnScreen: (() -> Bool)?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error { NSLog("Notification permission error: \(error.localizedDescription)") }
            NSLog("Notifications allowed: \(granted)")
        }
    }

    func post(id: String, title: String, body: String, thread: String, iconURL: URL?, sound: Bool) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.threadIdentifier = thread
        content.userInfo = ["id": id]
        if sound { content.sound = .default }

        guard let iconURL else { return deliver(id, content) }
        // Attach the sender's photo if it arrives quickly; never hold the banner back for long.
        URLSession.shared.dataTask(with: URLRequest(url: iconURL, timeoutInterval: 1.5)) { data, response, _ in
            if let data, let attachment = Self.attachment(data: data, mimeType: response?.mimeType) {
                content.attachments = [attachment]
            }
            self.deliver(id, content)
        }.resume()
    }

    private func deliver(_ id: String, _ content: UNNotificationContent) {
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    private static func attachment(data: Data, mimeType: String?) -> UNNotificationAttachment? {
        let ext = switch mimeType {
        case "image/png": "png"
        case "image/gif": "gif"
        default: "jpg"
        }
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        do {
            try data.write(to: file)
            return try UNNotificationAttachment(identifier: "photo", url: file)
        } catch {
            return nil
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Only called while the app is frontmost. If the window is on screen, Messenger already shows it.
        Task { @MainActor in
            completionHandler(self.isWindowOnScreen?() == true ? [] : [.banner, .list, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["id"] as? String ?? ""
        Task { @MainActor in
            self.onClick?(id)
            completionHandler()
        }
    }
}

// MARK: - Entry point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
