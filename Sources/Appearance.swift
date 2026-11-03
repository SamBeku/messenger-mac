import AppKit

/// The look options from the Settings window, as the page script needs them.
struct AppearanceSettings: Equatable {
    var seamless: Bool
    var glass: Bool
    var compact: Bool
    var hideFilters: Bool
    var hideNudges: Bool
    var messagesList: Bool
    var closeInfoPanel: Bool
    /// Hex colors, or nil when the custom accent color is off.
    var accent: String?
    var accentLight: String?

    init(_ defaults: UserDefaults) {
        seamless = defaults.bool(forKey: Pref.seamlessTitleBar)
        glass = defaults.bool(forKey: Pref.glassSidebar)
        compact = defaults.bool(forKey: Pref.compactList)
        hideFilters = defaults.bool(forKey: Pref.hideFilters)
        hideNudges = defaults.bool(forKey: Pref.hideNudges)
        messagesList = defaults.bool(forKey: Pref.messagesList)
        closeInfoPanel = defaults.bool(forKey: Pref.closeInfoPanel)
        if defaults.bool(forKey: Pref.accentEnabled) {
            // No color picked yet means "use the Mac's accent color".
            let color = NSColor(hex: defaults.string(forKey: Pref.accentColor) ?? "") ?? .controlAccentColor
            accent = color.hexString
            accentLight = color.blended(withFraction: 0.3, of: .white)?.hexString
        }
    }

    var pageSettings: [String: Any] {
        [
            "seamless": seamless, "glass": glass, "compact": compact,
            "hideFilters": hideFilters, "hideNudges": hideNudges, "messagesList": messagesList,
            "closeInfoPanel": closeInfoPanel,
            "accent": accent ?? NSNull(), "accentLight": accentLight ?? NSNull(),
        ]
    }

    var pageSettingsJSON: String {
        let data = try? JSONSerialization.data(withJSONObject: pageSettings)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}

/// Invisible strip along the top of the window. With the seamless title bar the page reaches
/// the top edge, so this keeps the window draggable (and double-click to zoom) there.
final class TitlebarDragView: NSView {
    static let height: CGFloat = 28

    override var mouseDownCanMoveWindow: Bool { true }

    override func mouseDown(with event: NSEvent) {
        guard event.clickCount == 2 else {
            window?.performDrag(with: event)
            return
        }
        // Respect System Settings → Desktop & Dock → "Double-click a window's title bar to".
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": window?.performMiniaturize(nil)
        case "None": break
        default: window?.performZoom(nil)
        }
    }
}

extension NSColor {
    convenience init?(hex: String) {
        var digits = hex.trimmingCharacters(in: .whitespaces)
        if digits.hasPrefix("#") { digits.removeFirst() }
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                  blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    var hexString: String {
        guard let rgb = usingColorSpace(.sRGB) else { return "#0866FF" }
        let channel = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", channel(rgb.redComponent), channel(rgb.greenComponent), channel(rgb.blueComponent))
    }
}
