import Foundation

let directory = FileManager.default.temporaryDirectory.appendingPathComponent("codex-rollout-tests-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let file = directory.appendingPathComponent("rollout.jsonl")
var failures = 0
var checks = 0

func expect(_ name: String, _ text: String, _ expected: String?) throws {
    try Data(text.utf8).write(to: file)
    let actual = Rollout.lastTurnMarker(ofFileAt: file.path)
    checks += 1
    if actual != expected {
        failures += 1
        print("FAIL: \(name): expected \(expected ?? "nil"), got \(actual ?? "nil")")
    } else {
        print("PASS: \(name)")
    }
}

func event(_ type: String) -> String {
    "{\"type\":\"event_msg\",\"payload\":{\"type\":\"\(type)\"}}\n"
}

try expect("legacy start marker", event("task_started"), "task_started")
try expect("latest lifecycle marker wins", event("task_started") + event("task_complete"), "task_complete")
try expect("aborted turns", event("turn_aborted"), "turn_aborted")
try expect("v2 start alias", event("turn_started"), "task_started")
try expect("v2 completion alias", event("turn_complete"), "task_complete")
try expect("whitespace and field order", "{\"payload\": {\"type\": \"turn_aborted\"}, \"type\": \"event_msg\"}\n", "turn_aborted")
try expect("nested types are not lifecycle markers",
    "{\"type\":\"event_msg\",\"payload\":{\"type\":\"agent_message\",\"metadata\":{\"type\":\"task_complete\"}}}\n", nil)
try expect("response items are not lifecycle markers",
    "{\"type\":\"response_item\",\"payload\":{\"type\":\"event_msg\",\"metadata\":{\"type\":\"turn_aborted\"}}}\n", nil)
try expect("partial last records cannot end a turn",
    event("task_started") + "{\"type\":\"event_msg\",\"payload\":{\"type\":\"turn_aborted\"", "task_started")
try expect("messages mentioning marker JSON do not end a turn",
    event("task_started") + "{\"type\":\"event_msg\",\"payload\":{\"type\":\"agent_message\",\"message\":\"\\\"type\\\":\\\"task_complete\\\"\"}}\n", "task_started")
try expect("old markers outside the tail are ignored",
    event("task_complete") + String(repeating: "x", count: 9000) + "\n", nil)
// 8192 bytes from the end lands inside a four-byte character in the filler line.
try expect("tail starting inside UTF-8 still detects the abort",
    String(repeating: "🦉", count: 3000) + "x\n" + event("turn_aborted"), "turn_aborted")
try expect("empty transcripts", "", nil)
checks += 1
if Rollout.lastTurnMarker(ofFileAt: directory.appendingPathComponent("missing").path) != nil {
    failures += 1
    print("FAIL: missing transcripts")
}
print("\(checks) rollout checks, \(failures) failures")
exit(failures == 0 ? 0 : 1)
