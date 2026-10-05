import AppKit

enum OrbitRenderer {
    static let frames: [String: [NSImage]] = {
        var output: [String: [NSImage]] = [:]
        for strip in workingMarkStrips {
            guard let data = Data(base64Encoded: strip.data), let image = NSImage(data: data),
                  let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
            output[strip.name] = (0..<strip.frames).compactMap { index in
                cg.cropping(to: CGRect(x: 0, y: index * 48, width: 48, height: 48))
                    .map { NSImage(cgImage: $0, size: NSSize(width: 48, height: 48)) }
            }
        }
        return output
    }()

    static func image(at frame: Int, color: NSColor?, prompt: NSImage) -> NSImage {
        guard OrbitAnimation.sequence.indices.contains(frame) else { return prompt }
        let step = OrbitAnimation.sequence[frame]
        guard let strip = frames[step.strip], strip.indices.contains(step.frame) else { return prompt }
        let size = NSSize(width: 18, height: 18)
        let dotSize: CGFloat = 18 * 1.08
        let dotRect = NSRect(x: (18 - dotSize) / 2, y: (18 - dotSize) / 2, width: dotSize, height: dotSize)
        let mask = strip[step.frame]
        let scaled = NSImage(size: size, flipped: false) { _ in
            mask.draw(in: dotRect, from: .zero, operation: .sourceOver, fraction: 1)
            return true
        }
        // Only the source alpha is used. The upstream orange never leaks into the
        // Codex Blue variant or the adaptive System template.
        let dots = NSImage(size: size, flipped: false) { rect in
            (color ?? .black).setFill()
            rect.fill()
            scaled.draw(in: rect, from: .zero, operation: .destinationIn, fraction: 1)
            return true
        }
        let promptAlpha = OrbitAnimation.promptOpacity(at: frame)
        let output = NSImage(size: size, flipped: false) { _ in
            dots.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1 - promptAlpha)
            if promptAlpha > 0 {
                prompt.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: promptAlpha)
            }
            return true
        }
        output.isTemplate = color == nil
        return output
    }
}
