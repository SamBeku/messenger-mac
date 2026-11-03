import AppKit
import UniformTypeIdentifiers

/// How chats look, set by right-clicking a chat's background: a wallpaper (an image or a color) and
/// a bubble color, per chat or for all chats ("default"). Saved as
/// {"/messages/t/123": {"wallpaper": "image:<file>" | "color:#RRGGBB" | "none", "bubble": "#RRGGBB"}, …}.
/// The page applies them (applyLooks in bridge.js); wallpaper images live in Application Support and
/// reach the page one at a time, when a chat shows one.
enum ChatLooks {
    static let allChats = "default"

    static var all: [String: [String: String]] {
        guard let json = UserDefaults.standard.string(forKey: Pref.chatLooks), let data = json.data(using: .utf8),
              let looks = try? JSONDecoder().decode([String: [String: String]].self, from: data)
        else { return [:] }
        return looks
    }

    static var json: String {
        UserDefaults.standard.string(forKey: Pref.chatLooks) ?? "{}"
    }

    /// Sets (or with nil, clears) one value for a chat or for all chats.
    static func set(_ key: String, _ value: String?, for scope: String) {
        var looks = all
        var look = looks[scope] ?? [:]
        look[key] = value
        looks[scope] = look.isEmpty ? nil : look
        if let data = try? JSONEncoder().encode(looks) {
            UserDefaults.standard.set(String(data: data, encoding: .utf8), forKey: Pref.chatLooks)
        }
        removeUnusedImages(looks)
    }

    // MARK: Wallpaper images

    static let folder: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Messenger/Wallpapers", isDirectory: true)
    }()

    /// Copies a picked image in, at most 2560 pixels wide or tall, and returns its file name.
    static func importImage(_ url: URL) -> String? {
        guard let image = NSImage(contentsOf: url),
              let source = image.representations.first.map({ NSSize(width: $0.pixelsWide, height: $0.pixelsHigh) })
        else { return nil }
        let scale = min(1, 2560 / max(source.width, source.height, 1))
        let size = NSSize(width: (source.width * scale).rounded(), height: (source.height * scale).rounded())
        guard size.width > 0, size.height > 0,
              let rep = NSBitmapImageRep(
                  bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else { return nil }
        let name = UUID().uuidString + ".jpg"
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try jpeg.write(to: folder.appendingPathComponent(name))
            return name
        } catch {
            return nil
        }
    }

    static func dataURL(_ name: String) -> String? {
        guard !name.contains("/"), let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
        return "data:image/jpeg;base64," + data.base64EncodedString()
    }

    private static func removeUnusedImages(_ looks: [String: [String: String]]) {
        let used = Set(looks.values.compactMap { $0["wallpaper"] }.filter { $0.hasPrefix("image:") }.map { String($0.dropFirst(6)) })
        let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        for file in files where !used.contains(file) {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(file))
        }
    }

    // MARK: Menu

    enum Choice { case image, color, none, reset }

    /// Wallpaper and Bubble Color for this chat, then Wallpaper for All Chats. A choice comes back as
    /// (scope, "wallpaper" or "bubble", what to do).
    static func menu(for path: String, perform: @escaping (_ scope: String, _ key: String, _ choice: Choice) -> Void) -> NSMenu {
        let looks = all
        let chat = looks[path] ?? [:]
        let menu = NSMenu()

        func submenu(_ title: String, symbol: String, items: [NSMenuItem]) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            item.submenu = NSMenu()
            items.forEach(item.submenu!.addItem)
            return item
        }
        func checked(_ item: NSMenuItem, _ on: Bool) -> NSMenuItem {
            item.state = on ? .on : .off
            return item
        }

        menu.addItem(submenu("Wallpaper", symbol: "photo", items: [
            ActionMenuItem("Choose Image…", symbol: "photo.on.rectangle") { perform(path, "wallpaper", .image) },
            ActionMenuItem("Choose Color…", symbol: "paintpalette") { perform(path, "wallpaper", .color) },
            .separator(),
            checked(ActionMenuItem("Same as All Chats", symbol: nil) { perform(path, "wallpaper", .reset) }, chat["wallpaper"] == nil),
            checked(ActionMenuItem("None", symbol: nil) { perform(path, "wallpaper", .none) }, chat["wallpaper"] == "none"),
        ]))
        menu.addItem(submenu("Bubble Color", symbol: "bubble.left.fill", items: [
            ActionMenuItem("Choose Color…", symbol: "paintpalette") { perform(path, "bubble", .color) },
            .separator(),
            checked(ActionMenuItem("Default", symbol: nil) { perform(path, "bubble", .reset) }, chat["bubble"] == nil),
        ]))
        menu.addItem(.separator())
        let everywhere = looks[allChats]?["wallpaper"]
        menu.addItem(submenu("Wallpaper for All Chats", symbol: "rectangle.stack", items: [
            ActionMenuItem("Choose Image…", symbol: "photo.on.rectangle") { perform(allChats, "wallpaper", .image) },
            ActionMenuItem("Choose Color…", symbol: "paintpalette") { perform(allChats, "wallpaper", .color) },
            .separator(),
            checked(ActionMenuItem("None", symbol: nil) { perform(allChats, "wallpaper", .reset) }, everywhere == nil),
        ]))
        return menu
    }
}

/// Feeds the shared color panel's picks to a closure, live, like other Mac apps' color choices.
final class ColorPick: NSObject {
    private let onChange: (NSColor) -> Void

    init(color: NSColor?, onChange: @escaping (NSColor) -> Void) {
        self.onChange = onChange
        super.init()
        let panel = NSColorPanel.shared
        panel.setTarget(nil)
        if let color { panel.color = color }
        panel.showsAlpha = false
        panel.isContinuous = true
        panel.setTarget(self)
        panel.setAction(#selector(changed(_:)))
        panel.orderFront(nil)
    }

    @objc private func changed(_ panel: NSColorPanel) {
        onChange(panel.color)
    }
}
