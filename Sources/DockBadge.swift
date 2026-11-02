import AppKit

/// The Dock icon with the unread count drawn on it. macOS hides the system badge
/// (`dockTile.badgeLabel`) for apps without notification permission, so we draw our own.
final class DockBadgeView: NSView {
    var count = 0 {
        didSet { if count != oldValue { NSApp.dockTile.display() } }
    }

    override func draw(_ dirtyRect: NSRect) {
        NSApp.applicationIconImage.draw(in: bounds)
        guard count > 0 else { return }

        let text = count > 99 ? "99+" : String(count)
        let height = bounds.height * 0.36
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: height * 0.62, weight: .semibold),
            .foregroundColor: NSColor.white,
        ]
        let textSize = (text as NSString).size(withAttributes: attributes)
        let width = max(height, textSize.width + height * 0.55)
        // Top-right corner, overlapping the icon's edge like the system badge.
        let pill = NSRect(x: bounds.maxX - width, y: bounds.maxY - height, width: width, height: height)
        NSColor.systemRed.setFill()
        NSBezierPath(roundedRect: pill, xRadius: height / 2, yRadius: height / 2).fill()
        (text as NSString).draw(
            at: NSPoint(x: pill.midX - textSize.width / 2, y: pill.midY - textSize.height / 2),
            withAttributes: attributes)
    }
}
