import Foundation

let suite = "codex-statusbar-preferences-tests-\(UUID().uuidString)"
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    checks += 1
    guard condition() else { fatalError(message) }
}

expect(!StatusPreferences.showLabel(in: defaults), "a fresh install stays quiet")
defaults.set(true, forKey: "thinkingWords")
expect(StatusPreferences.showLabel(in: defaults), "an enabled legacy text setting migrates")
expect(defaults.bool(forKey: "showLabel"), "the migrated setting is saved")
defaults.set(false, forKey: "showLabel")
expect(!StatusPreferences.showLabel(in: defaults), "the new setting takes precedence over the old setting")
defaults.removePersistentDomain(forName: suite)
defaults.set(false, forKey: "thinkingWords")
expect(!StatusPreferences.showLabel(in: defaults), "a disabled legacy text setting stays disabled")
defaults.set(true, forKey: "showLabel")
expect(StatusPreferences.showLabel(in: defaults), "explicitly enabling text overrides the disabled legacy setting")

expect(StatusPreferences.barText(label: "Awaiting permission", showLabel: false, clock: nil) == "",
       "Show text off hides the permission label too")
expect(StatusPreferences.barText(label: "Awaiting your input", showLabel: true, clock: nil) == "Awaiting your input",
       "Show text on keeps the distinction between input and approval")
expect(StatusPreferences.barText(label: "Running command", showLabel: false, clock: "1m 1s") == "1m 1s",
       "the timer remains independent when text is hidden")
expect(StatusPreferences.barText(label: "Running command", showLabel: true, clock: "1m 1s") == "Running command  1m 1s",
       "the visible label and timer have consistent spacing")
expect(StatusPreferences.barText(label: "", showLabel: true, clock: "1m 1s") == "1m 1s",
       "an empty label adds no leading padding")
print("\(checks) preferences checks, 0 failures")
