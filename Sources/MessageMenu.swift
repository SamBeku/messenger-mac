import AppKit

/// The right-click menu for a message, laid out like Messages: a row of quick reactions, then
/// Reply / Forward / Copy… with icons. The page says what the message offers (openMessageMenu in
/// bridge.js), and each choice goes back to the page as an action, except Copy.
enum MessageMenu {
    private enum Kind { case edit, forward, pin, remove, other }

    // Facebook's own "More" items, recognised in English and Estonian.
    private static func kind(of label: String) -> Kind {
        let lower = label.lowercased()
        if lower.hasPrefix("edit") || lower.hasPrefix("muuda") { return .edit }
        if lower.hasPrefix("forward") || lower.hasPrefix("saada edasi") { return .forward }
        if lower.hasPrefix("pin") || lower.hasPrefix("kinnita") { return .pin }
        if ["unsend", "remove", "delete", "eemalda", "kustuta"].contains(where: lower.hasPrefix) { return .remove }
        return .other
    }

    static func make(from body: [String: Any], reactions: [String],
                     perform: @escaping (_ action: String, _ value: String?) -> Void) -> NSMenu {
        let menu = NSMenu()

        if !reactions.isEmpty {
            let row = NSMenuItem()
            row.view = ReactionRowView(
                reactions: reactions,
                onPick: { perform("react", $0) },
                onCustomize: { perform("customize-reactions", nil) })
            menu.addItem(row)
        }

        var reply: [NSMenuItem] = []
        var forward: [NSMenuItem] = []
        var other: [NSMenuItem] = []
        var remove: [NSMenuItem] = []
        if body["reply"] as? Bool == true {
            reply.append(ActionMenuItem("Reply…", symbol: "arrowshape.turn.up.left") { perform("reply", nil) })
        }
        for label in body["more"] as? [String] ?? [] {
            let action = { perform("more", label) }
            switch kind(of: label) {
            case .edit: reply.append(ActionMenuItem(label, symbol: "pencil", handler: action))
            case .forward: forward.append(ActionMenuItem("\(label)…", symbol: "arrowshape.turn.up.right", handler: action))
            case .pin: other.append(ActionMenuItem(label, symbol: "pin", handler: action))
            case .remove: remove.append(ActionMenuItem("\(label)…", symbol: "trash", handler: action))
            case .other: other.append(ActionMenuItem(label, symbol: nil, handler: action))
            }
        }
        if let text = body["text"] as? String, !text.isEmpty {
            forward.append(ActionMenuItem("Copy", symbol: "doc.on.doc") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            })
        }

        for group in [reply, forward + other, remove] where !group.isEmpty {
            if !menu.items.isEmpty { menu.addItem(.separator()) }
            group.forEach(menu.addItem)
        }
        return menu
    }
}

/// A menu item that runs a closure, with an optional SF Symbol icon.
final class ActionMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, symbol: String?, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: "")
        target = self
        if let symbol { image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
    }

    required init(coder: NSCoder) {
        fatalError("not used")
    }

    @objc private func run() {
        handler()
    }
}

/// The quick reactions across the top of the menu, like Messages' tapbacks: up to 5 per line
/// (a second line for 6–10), with "+" to customize them at the end of the first line.
final class ReactionRowView: NSView {
    static let perLine = 5
    private static let cellSize: CGFloat = 40
    private static let inset: CGFloat = 10

    init(reactions: [String], onPick: @escaping (String) -> Void, onCustomize: @escaping () -> Void) {
        let lines = reactions.count > Self.perLine ? 2 : 1
        let width = Self.inset * 2 + CGFloat(Self.perLine + 1) * Self.cellSize
        super.init(frame: NSRect(x: 0, y: 0, width: width, height: CGFloat(lines) * Self.cellSize + 8))
        for (index, emoji) in reactions.prefix(Self.perLine * 2).enumerated() {
            place(ReactionCell(emoji: emoji) { onPick(emoji) }, line: index / Self.perLine, column: index % Self.perLine)
        }
        place(ReactionCell(symbol: "plus", label: "Customize Reactions") { onCustomize() }, line: 0, column: Self.perLine)
    }

    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    private func place(_ cell: ReactionCell, line: Int, column: Int) {
        // Line 0 is the top one (AppKit counts y from the bottom).
        let y = bounds.height - 4 - CGFloat(line + 1) * Self.cellSize
        cell.frame = NSRect(x: Self.inset + CGFloat(column) * Self.cellSize, y: y, width: Self.cellSize, height: Self.cellSize)
        addSubview(cell)
    }
}

/// One emoji (or the "+") in the reaction row: a round highlight on hover, picked on click.
final class ReactionCell: NSView {
    private let emoji: String?
    private let action: () -> Void
    private var hovered = false {
        didSet { needsDisplay = true }
    }

    init(emoji: String? = nil, symbol: String? = nil, label: String? = nil, action: @escaping () -> Void) {
        self.emoji = emoji
        self.action = action
        super.init(frame: .zero)
        setAccessibilityRole(.button)
        setAccessibilityLabel(label ?? emoji)
        if let symbol {
            let icon = NSImageView(image: NSImage(systemSymbolName: symbol, accessibilityDescription: label) ?? NSImage())
            icon.symbolConfiguration = .init(pointSize: 15, weight: .semibold)
            icon.contentTintColor = .secondaryLabelColor
            icon.frame = NSRect(x: 0, y: 0, width: 40, height: 40)
            addSubview(icon)
        }
    }

    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self))
    }

    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }

    override func mouseUp(with event: NSEvent) {
        enclosingMenuItem?.menu?.cancelTracking()
        action()
    }

    override func draw(_ dirtyRect: NSRect) {
        let circle = NSBezierPath(ovalIn: bounds.insetBy(dx: 3, dy: 3))
        if hovered {
            NSColor.labelColor.withAlphaComponent(0.14).setFill()
            circle.fill()
        } else if emoji == nil {
            NSColor.labelColor.withAlphaComponent(0.07).setFill() // the "+" sits on a faint circle
            circle.fill()
        }
        guard let emoji else { return }
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 25)]
        let size = (emoji as NSString).size(withAttributes: attributes)
        (emoji as NSString).draw(
            at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2),
            withAttributes: attributes)
    }
}
