import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = StatusController(startRuntime: false)
defer {
    controller.animTimer?.invalidate()
    controller.pollTimer?.invalidate()
    NSStatusBar.system.removeStatusItem(controller.statusItem)
}
var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    checks += 1
    guard condition() else { fatalError(message) }
}

expect(controller.pollTimer == nil, "render-only construction must not start session polling")
expect(controller.sessions.isEmpty, "render-only construction must not load live sessions")
let resting = controller.restingIcon(color: controller.brand)
let restingBitmap = resting.representations.first as! NSBitmapImageRep
expect((restingBitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? 1) == 0,
       "scaled tinted glyphs must not leave an opaque border around the prompt")
expect(StatusController.AnimStyle(rawValue: "orbit") == .orbit, "Orbit is selectable without changing existing raw values")
controller.animStyle = .orbit
controller.render(label: "Working", color: controller.brand, animate: true,
                  startedAt: Date().timeIntervalSince1970 - 61)
if controller.reduceMotion {
    expect(controller.animTimer == nil, "Reduce Motion keeps Orbit static")
    expect(controller.statusItem.button?.image != nil, "Reduce Motion retains a working icon")
} else {
    expect(controller.animTimer?.isValid == true, "working starts the Orbit timer")
    for _ in 0..<10 { controller.animStep() }
    controller.render(label: "", color: controller.brand, animate: false, startedAt: 0)
    expect(controller.orbitOutro, "completion begins the outro")
    expect(controller.frameIdx == 396, "the outro starts at the exit strip")
    var ticks = 0
    while controller.animTimer != nil && ticks < 20 { controller.animStep(); ticks += 1 }
    expect(controller.animTimer == nil && !controller.orbitOutro, "completion stops animation after the outro")
    expect(controller.statusItem.button?.image === controller.restingIcon(color: controller.brand),
           "completion restores the cached Codex prompt")

    controller.render(label: "Working", color: controller.brand, animate: true, startedAt: 1)
    for _ in 0..<10 { controller.animStep() }
    controller.render(label: "", color: controller.brand, animate: false, startedAt: 0)
    controller.render(label: "Awaiting permission", color: controller.amber, animate: false, startedAt: 0, dot: true)
    expect(controller.animTimer == nil && !controller.orbitOutro, "approval immediately preempts the outro")
    expect(controller.statusItem.button?.image === controller.dotIcon(color: controller.amber),
           "approval shows the amber dot instead of an animation frame")

    controller.render(label: "Working", color: controller.brand, animate: true, startedAt: 1)
    for _ in 0..<10 { controller.animStep() }
    controller.render(label: "", color: controller.brand, animate: false, startedAt: 0)
    controller.render(label: "Working", color: controller.brand, animate: true, startedAt: 1)
    expect(!controller.orbitOutro && controller.frameIdx == 16, "new work resumes the body instead of finishing the previous outro")
    controller.render(label: "Awaiting permission", color: controller.amber, animate: false, startedAt: 0, dot: true)
}

controller.showLabel = false
controller.render(label: "Awaiting your input", color: controller.amber, animate: false, startedAt: 0, dot: true)
expect(controller.statusItem.button?.attributedTitle.string == "", "the real status button hides attention text")
controller.showLabel = true
controller.applyTitle()
expect(controller.statusItem.button?.attributedTitle.string.contains("Awaiting your input") == true,
       "the text toggle updates the real status button immediately")
controller.showLabel = false
controller.showTimer = true
controller.render(label: "Running command", color: controller.brand, animate: true,
                  startedAt: Date().timeIntervalSince1970 - 61)
expect(controller.statusItem.button?.attributedTitle.string.contains("1m") == true,
       "the real status button retains the timer when text is off")
var session = StatusController.Session(json: ["state": "permission", "label": "Awaiting your input"], id: "test")
session.eff = "permission"
expect(controller.sessionTooltip(session).contains("Awaiting your input"), "hover descriptions remain informative with text off")
print("\(checks) controller checks, 0 failures")
