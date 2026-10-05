import Foundation

// Upstream uses 30-fps strips, sampled every other frame at 15 fps. Entrance
// plays once; the orbit and breathing sections loop; the exit plays on completion.
enum OrbitAnimation {
    static let fps: Double = 15
    static let advance = 2
    static let fadeFrames = 4
    static let sequence: [(strip: String, frame: Int)] = {
        func count(_ name: String) -> Int { workingMarkStrips.first { $0.name == name }?.frames ?? 0 }
        var steps: [(strip: String, frame: Int)] = []
        for i in 0..<count("en110") { steps.append(("en110", i)) }
        for _ in 0..<2 { for i in 0..<count("loop110") { steps.append(("loop110", i)) } }
        for _ in 0..<4 { for i in 0..<count("loop40") { steps.append(("loop40", i)) } }
        for i in 0..<count("ex40") { steps.append(("ex40", i)) }
        return steps
    }()
    static var loopStart: Int { workingMarkStrips.first { $0.name == "en110" }?.frames ?? 0 }
    static var bodyCount: Int { sequence.count - (workingMarkStrips.first { $0.name == "ex40" }?.frames ?? 0) }

    static func nextFrame(after frame: Int, exiting: Bool) -> Int? {
        let next = frame + advance
        if exiting { return next < sequence.count ? next : nil }
        if next >= bodyCount {
            let loopLength = max(1, bodyCount - loopStart)
            return loopStart + (next - loopStart) % loopLength
        }
        return next
    }

    static func promptOpacity(at frame: Int) -> CGFloat {
        guard sequence.indices.contains(frame) else { return 1 }
        let step = sequence[frame]
        if step.strip == "en110", step.frame < fadeFrames {
            return 1 - CGFloat(step.frame + 1) / CGFloat(fadeFrames)
        }
        if step.strip == "ex40" {
            let exitCount = workingMarkStrips.first { $0.name == "ex40" }?.frames ?? 0
            let tail = exitCount - step.frame - 1
            if tail < fadeFrames { return 1 - CGFloat(tail) / CGFloat(fadeFrames) }
        }
        return 0
    }
}
