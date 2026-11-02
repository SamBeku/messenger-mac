import ServiceManagement
import SwiftUI

/// The Settings window (⌘,). Every switch writes straight to UserDefaults, and the app
/// re-applies the look as soon as a value changes.
struct SettingsView: View {
    @AppStorage(Pref.seamlessTitleBar) private var seamlessTitleBar = true
    @AppStorage(Pref.glassSidebar) private var glassSidebar = true
    @AppStorage(Pref.accentEnabled) private var accentEnabled = true
    @AppStorage(Pref.accentColor) private var accentColor = ""
    @AppStorage(Pref.compactList) private var compactList = true
    @AppStorage(Pref.hideFilters) private var hideFilters = true
    @AppStorage(Pref.hideNudges) private var hideNudges = true
    @AppStorage(Pref.closeInfoPanel) private var closeInfoPanel = true
    @AppStorage(Pref.notifications) private var notifications = true
    @AppStorage(Pref.sound) private var sound = true
    @AppStorage(Pref.previews) private var previews = true
    @State private var openAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        Form {
            Section("Window") {
                Toggle("Seamless title bar", isOn: $seamlessTitleBar)
                Toggle("Frosted-glass sidebar", isOn: $glassSidebar)
            }

            Section {
                Toggle("Custom accent color", isOn: $accentEnabled)
                ColorPicker("Color", selection: accentBinding, supportsOpacity: false)
                    .disabled(!accentEnabled)
                Button("Use Mac Accent Color") { accentColor = "" }
                    .disabled(!accentEnabled || accentColor.isEmpty)
            } header: {
                Text("Colors")
            } footer: {
                Text("Replaces Messenger's blue and every chat's theme colors.")
            }

            Section("Chat list") {
                Toggle("Compact chat list", isOn: $compactList)
                Toggle("Hide filter row (All / Unread / Groups)", isOn: $hideFilters)
                Toggle("Hide “Reply?” and “Follow up?” nudges", isOn: $hideNudges)
            }

            Section {
                Toggle("Keep info panel closed", isOn: $closeInfoPanel)
            } header: {
                Text("Conversation")
            } footer: {
                Text("Closes the panel when you switch chats. The ⓘ button still opens it.")
            }

            Section("Notifications") {
                Toggle("Show notifications", isOn: $notifications)
                Toggle("Play sound", isOn: $sound).disabled(!notifications)
                Toggle("Show message previews", isOn: $previews).disabled(!notifications)
            }

            Section("General") {
                Toggle("Open at login", isOn: openAtLoginBinding)
            }
        }
        .formStyle(.grouped)
        .frame(width: 440, height: 720) // a grouped Form scrolls, so it has no natural height
    }

    private var accentBinding: Binding<Color> {
        Binding(
            get: { Color(nsColor: NSColor(hex: accentColor) ?? .controlAccentColor) },
            set: { accentColor = NSColor($0).hexString })
    }

    private var openAtLoginBinding: Binding<Bool> {
        Binding(
            get: { openAtLogin },
            set: { enable in
                do {
                    if enable { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                } catch {
                    _ = NSAlert(error: error).runModal()
                }
                openAtLogin = SMAppService.mainApp.status == .enabled
            })
    }
}
