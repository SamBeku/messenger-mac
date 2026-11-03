import AppKit

/// SF Symbols for the page, which can't use them itself: each drawn once as a PNG data URL that
/// the page uses as a mask (so it takes the page's colors). bridge.js decides which Facebook
/// buttons get which symbol (ICONS) and keeps Facebook's own icon for any symbol missing here.
enum PageSymbols {
    static let names = [
        "phone.fill", "video.fill", "info.circle", "plus.circle.fill", "mic.fill", "photo.on.rectangle",
        "face.smiling.inverse", "play.square.stack", "face.smiling", "hand.thumbsup.fill", "arrow.up.circle.fill",
        "plus.circle",
    ]

    /// {"phone.fill": "data:image/png;base64,…", …} as JSON, for window.__mdeskSymbols.
    static let json: String = {
        var urls: [String: String] = [:]
        for name in names {
            if let url = dataURL(name) { urls[name] = url }
        }
        let data = try? JSONSerialization.data(withJSONObject: urls)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }()

    /// Drawn at 40pt: about 20 page pixels at 2x, sharp on Retina screens.
    private static func dataURL(_ name: String) -> String? {
        let config = NSImage.SymbolConfiguration(pointSize: 40, weight: .regular)
        guard let symbol = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(config) else { return nil }
        let size = symbol.size
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width.rounded(.up)), pixelsHigh: Int(size.height.rounded(.up)),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        symbol.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }
}
