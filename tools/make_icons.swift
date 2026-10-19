// ホーム画面用アイコン（赤地に白いダンベル）をPNGで書き出す
// usage: swift tools/make_icons.swift icons
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icons"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

func draw(_ size: Int) -> Data {
    let s = CGFloat(size)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(red: 0.85, green: 0.17, blue: 0.17, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    NSColor.white.setFill()
    let u = s / 100
    // バー
    NSBezierPath(roundedRect: NSRect(x: 22 * u, y: 46 * u, width: 56 * u, height: 8 * u), xRadius: 3 * u, yRadius: 3 * u).fill()
    // プレート（左右に2枚ずつ）
    for (x, h) in [(14.0, 40.0), (24.0, 30.0), (68.0, 30.0), (78.0, 40.0)] {
        NSBezierPath(roundedRect: NSRect(x: CGFloat(x) * u, y: (50 - CGFloat(h) / 2) * u, width: 8 * u, height: CGFloat(h) * u),
                     xRadius: 2.5 * u, yRadius: 2.5 * u).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [180, 192, 512] {
    let path = "\(outDir)/icon-\(size).png"
    try! draw(size).write(to: URL(fileURLWithPath: path))
    print("wrote \(path)")
}
