// Draws the 1024×1024 app icon: a gradient squircle with a white chat bubble.
// Usage: make-icon <output.png>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!

func color(_ hex: UInt32) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

let gradient = CGGradient(
    colorsSpace: space,
    colors: [color(0x0099FF), color(0x7A45FF), color(0xC23BEF), color(0xFF5280), color(0xFF7A5C)] as CFArray,
    locations: [0, 0.4, 0.65, 0.88, 1])!
let gradientStart = CGPoint(x: 160, y: 120)
let gradientEnd = CGPoint(x: 880, y: 920)

// Squircle body on the standard macOS icon grid (824pt body, 100pt margin).
let body = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824),
                  cornerWidth: 186, cornerHeight: 186, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: CGColor(gray: 0, alpha: 0.3))
ctx.addPath(body)
ctx.setFillColor(color(0x5A5AFF))
ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(body)
ctx.clip()
ctx.drawLinearGradient(gradient, start: gradientStart, end: gradientEnd,
                       options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
ctx.restoreGState()

// White speech bubble with a tail at the bottom left.
let bubble = CGMutablePath()
bubble.addEllipse(in: CGRect(x: 512 - 262, y: 528 - 250, width: 524, height: 500))
bubble.move(to: CGPoint(x: 345, y: 380))
bubble.addQuadCurve(to: CGPoint(x: 318, y: 238), control: CGPoint(x: 352, y: 300))
bubble.addQuadCurve(to: CGPoint(x: 455, y: 300), control: CGPoint(x: 395, y: 262))
bubble.closeSubpath()
ctx.addPath(bubble)
ctx.setFillColor(CGColor(gray: 1, alpha: 1))
ctx.fillPath()

// Zig-zag through the bubble, filled with the same gradient.
let bolt = CGMutablePath()
bolt.addLines(between: [
    CGPoint(x: 352, y: 456), CGPoint(x: 466, y: 584), CGPoint(x: 558, y: 470), CGPoint(x: 672, y: 598),
])
ctx.saveGState()
ctx.addPath(bolt)
ctx.setLineWidth(64)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.replacePathWithStrokedPath()
ctx.clip()
ctx.drawLinearGradient(gradient, start: gradientStart, end: gradientEnd,
                       options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
ctx.restoreGState()

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("Could not write \(output.path)") }
