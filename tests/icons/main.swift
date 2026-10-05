import AppKit

var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    checks += 1
    guard condition() else { fatalError(message) }
}

// An AppKit drawing handler models the app's glyphs, dots, and animated shapes.
// Repainting the cached result must not call the original handler again.
for template in [false, true] {
    var draws = 0
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
        draws += 1
        NSColor(srgbRed: 0.357, green: 0.553, blue: 0.937, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 4, y: 4, width: 10, height: 10)).fill()
        return true
    }
    image.isTemplate = template
    let flattened = IconRasterizer.flatten(image)
    expect(flattened !== image, "valid icons must be materialized as a new bitmap")
    expect(flattened.size == image.size, "logical size must stay 18 points")
    expect(flattened.isTemplate == template, "System color must remain adaptive")
    guard let bitmap = flattened.representations.first as? NSBitmapImageRep else {
        fatalError("cached icons must have a bitmap representation")
    }
    expect(bitmap.pixelsWide == 36 && bitmap.pixelsHigh == 36, "Retina resolution must be preserved")
    expect(bitmap.hasAlpha, "icons must retain transparency")
    expect((bitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? 1) == 0, "empty corners must remain transparent")
    expect((bitmap.colorAt(x: 18, y: 18)?.alphaComponent ?? 0) > 0.99, "the dot must remain opaque")
    if !template {
        guard let color = bitmap.colorAt(x: 18, y: 18)?.usingColorSpace(.sRGB) else {
            fatalError("the icon color must be readable")
        }
        expect(abs(color.redComponent - 0.357) < 0.02
               && abs(color.greenComponent - 0.553) < 0.02
               && abs(color.blueComponent - 0.937) < 0.02, "brand Blue must remain unchanged")
    }
    expect(draws > 0, "the source drawing must run during flattening")
    let renderedDraws = draws
    for _ in 0..<10 {
        guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            fatalError("a bitmap context must be available")
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        flattened.draw(in: NSRect(origin: .zero, size: flattened.size))
        NSGraphicsContext.restoreGraphicsState()
    }
    expect(draws == renderedDraws, "cached repainting must not replay the source drawing handler")
}
let empty = NSImage(size: .zero)
expect(IconRasterizer.flatten(empty) === empty, "invalid-size images must fall back without crashing")
print("\(checks) icon checks, 0 failures")
