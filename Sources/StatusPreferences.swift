import Foundation

enum StatusPreferences {
    static func showLabel(in defaults: UserDefaults) -> Bool {
        if defaults.object(forKey: "showLabel") != nil { return defaults.bool(forKey: "showLabel") }
        if defaults.object(forKey: "thinkingWords") != nil {
            let previous = defaults.bool(forKey: "thinkingWords")
            defaults.set(previous, forKey: "showLabel")
            return previous
        }
        return false // keep this port's quiet, icon-only default
    }

    static func barText(label: String, showLabel: Bool, clock: String?) -> String {
        let text = showLabel ? label : ""
        guard let clock = clock, !clock.isEmpty else { return text }
        return text.isEmpty ? clock : text + "  " + clock
    }
}
