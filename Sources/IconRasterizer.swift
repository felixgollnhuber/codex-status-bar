import AppKit

enum IconRasterizer {
    // NSImage's drawing-handler initializer stores drawing instructions. Cache a
    // Retina bitmap instead so assigning the same frame does not replay them.
    // Ported from m1ckc3s/claude-status-bar commit dc4cf880 (v0.4.5).
    static func flatten(_ image: NSImage) -> NSImage {
        let size = image.size
        guard size.width > 0, size.height > 0,
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,
                                            pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2),
                                            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                            isPlanar: false, colorSpaceName: .deviceRGB,
                                            bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return image }
        bitmap.size = size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        // Bitmap contexts use pixels; the draw handler uses the icon's point size.
        context.cgContext.scaleBy(x: CGFloat(bitmap.pixelsWide) / size.width,
                                  y: CGFloat(bitmap.pixelsHigh) / size.height)
        image.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .sourceOver, fraction: 1.0)
        NSGraphicsContext.restoreGraphicsState()
        let output = NSImage(size: size)
        output.addRepresentation(bitmap)
        output.isTemplate = image.isTemplate
        return output
    }
}
