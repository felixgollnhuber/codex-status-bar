import Foundation

// Keep transcript parsing independent of AppKit so recovery can be tested without
// launching the app or installing hooks in the developer's Codex configuration.
enum Rollout {
    static func lastTurnMarker(ofFileAt path: String) -> String? {
        guard let fh = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? fh.close() }
        let size = (try? fh.seekToEnd()) ?? 0
        let chunk: UInt64 = 8192
        try? fh.seek(toOffset: size > chunk ? size - chunk : 0)
        guard let data = try? fh.readToEnd() else { return nil }
        // The tail may begin inside UTF-8 or a JSON record. Decode lossily and
        // ignore incomplete records instead of losing the entire recovery read.
        let text = String(decoding: data, as: UTF8.self)
        for line in text.split(separator: "\n").reversed() {
            guard let record = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  record["type"] as? String == "event_msg",
                  let payload = record["payload"] as? [String: Any],
                  let type = payload["type"] as? String else { continue }
            // Codex's v1 rollout names and v2 aliases describe the same lifecycle.
            switch type {
            case "task_started", "turn_started": return "task_started"
            case "task_complete", "turn_complete": return "task_complete"
            case "turn_aborted": return "turn_aborted"
            default: continue
            }
        }
        return nil
    }
}
