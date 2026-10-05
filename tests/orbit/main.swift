import AppKit

var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    checks += 1
    guard condition() else { fatalError(message) }
}

expect(OrbitAnimation.loopStart == 16, "the entrance retains the source timing")
expect(OrbitAnimation.bodyCount == 396, "the orbit and breathing loops retain their repetition counts")
expect(OrbitAnimation.sequence.count == 410, "the source sequence includes the full outro")
expect(OrbitAnimation.nextFrame(after: 14, exiting: false) == 16, "the entrance flows into the body")
expect(OrbitAnimation.nextFrame(after: 394, exiting: false) == 16, "working loops skip the entrance and exit")
expect(OrbitAnimation.nextFrame(after: 396, exiting: true) == 398, "completion starts advancing through the outro")
expect(OrbitAnimation.nextFrame(after: 408, exiting: true) == nil, "the outro terminates instead of looping")
expect(OrbitAnimation.promptOpacity(at: 0) == 0.75, "the prompt fades out during the entrance")
expect(OrbitAnimation.promptOpacity(at: 16) == 0, "working dots have no prompt overlay")
expect(OrbitAnimation.promptOpacity(at: 409) == 1, "the last exit frame fully restores the prompt")

for strip in workingMarkStrips {
    expect(OrbitRenderer.frames[strip.name]?.count == strip.frames, "every frame in \(strip.name) must decode")
}
let prompt = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
    NSColor.black.setFill()
    NSBezierPath(rect: NSRect(x: 7, y: 7, width: 4, height: 4)).fill()
    return true
}
prompt.isTemplate = true
let blue = NSColor(srgbRed: 0.357, green: 0.553, blue: 0.937, alpha: 1)
for color in [blue, nil] as [NSColor?] {
    let rendered = IconRasterizer.flatten(OrbitRenderer.image(at: 16, color: color, prompt: prompt))
    expect(rendered.isTemplate == (color == nil), "System mode retains template semantics")
    let bitmap = rendered.representations.first as! NSBitmapImageRep
    expect(bitmap.pixelsWide == 36 && bitmap.pixelsHigh == 36, "Orbit is rendered at Retina resolution")
    var visible = 0
    var wrongColor = false
    for y in 0..<bitmap.pixelsHigh { for x in 0..<bitmap.pixelsWide {
        guard let sample = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB), sample.alphaComponent > 0.9 else { continue }
        visible += 1
        if color != nil {
            if abs(sample.redComponent - 0.357) > 0.03 || abs(sample.greenComponent - 0.553) > 0.03
                || abs(sample.blueComponent - 0.937) > 0.03 { wrongColor = true }
        } else if sample.redComponent > 0.03 || sample.greenComponent > 0.03 || sample.blueComponent > 0.03 {
            wrongColor = true
        }
    }}
    expect(visible > 20, "the decoded dots must be visible")
    expect(!wrongColor, "the original orange must not leak into the Codex icon")
}
expect(OrbitRenderer.image(at: -1, color: blue, prompt: prompt) === prompt, "an invalid frame safely rests on the prompt")
expect(OrbitRenderer.image(at: 410, color: blue, prompt: prompt) === prompt, "a completed sequence safely rests on the prompt")
print("\(checks) Orbit checks, 0 failures")
