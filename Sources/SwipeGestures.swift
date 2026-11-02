import AppKit
import WebKit

/// The main web view. Turns two-finger sideways swipes over the conversation into page
/// gestures (`swipe` in bridge.js): fingers left shows message times, right replies.
/// The trackpad's own phases (fingers down, moving, lifted) make the swipe follow the fingers exactly.
final class MessengerWebView: WKWebView {
    /// The message list in page (CSS) pixels, reported by the page; nil when no chat is open.
    var swipeRegion: CGRect?
    /// Called with "began" / "changed" / "ended" / "cancelled", how far the fingers moved
    /// sideways (positive = right), and where the swipe started in page pixels.
    var onSwipe: ((_ phase: String, _ distance: CGFloat, _ start: CGPoint) -> Void)?

    private enum Axis { case undecided, horizontal, vertical }
    private var axis = Axis.vertical
    private var start = CGPoint.zero
    private var dx: CGFloat = 0
    private var dy: CGFloat = 0
    private var swallowMomentum = false

    override func scrollWheel(with event: NSEvent) {
        // The coasting after a swipe we handled would otherwise nudge the page.
        if !event.momentumPhase.isEmpty {
            guard swallowMomentum else { return super.scrollWheel(with: event) }
            if event.momentumPhase.contains(.ended) || event.momentumPhase.contains(.cancelled) { swallowMomentum = false }
            return
        }
        // Mouse wheels have no phases; leave them alone.
        guard event.hasPreciseScrollingDeltas else { return super.scrollWheel(with: event) }

        // Which way the fingers moved, whatever the "natural scrolling" setting is.
        let fingerDX = event.isDirectionInvertedFromDevice ? event.scrollingDeltaX : -event.scrollingDeltaX

        switch event.phase {
        case .began:
            start = pagePoint(of: event)
            axis = swipeRegion?.contains(start) == true ? .undecided : .vertical
            dx = 0
            dy = 0
            swallowMomentum = false
        case .changed where axis == .undecided:
            dx += fingerDX
            dy += event.scrollingDeltaY
            // Decide once the fingers have moved a little: clearly sideways, or a normal scroll.
            if abs(dx) + abs(dy) >= 8 {
                axis = abs(dx) > abs(dy) * 1.2 ? .horizontal : .vertical
                if axis == .horizontal {
                    onSwipe?("began", dx, start)
                    return
                }
            }
        case .changed where axis == .horizontal:
            dx += fingerDX
            onSwipe?("changed", dx, start)
            return
        case .ended, .cancelled:
            if axis == .horizontal {
                onSwipe?(event.phase == .ended ? "ended" : "cancelled", dx, start)
                axis = .vertical
                swallowMomentum = true
                return
            }
            axis = .vertical
        default:
            break
        }
        super.scrollWheel(with: event)
    }

    private func pagePoint(of event: NSEvent) -> CGPoint {
        let point = convert(event.locationInWindow, from: nil)
        let y = isFlipped ? point.y : bounds.height - point.y
        return CGPoint(x: point.x / pageZoom, y: y / pageZoom)
    }
}
