# Contributing

Thanks for your interest. This is a tiny menu bar app and I'd like to keep it that way.

It does one thing: show Codex's live status on macOS. It stays local (the only network call is a daily update check), free (no API key, no spend), and small (a status bar, not a dashboard).

This project is itself a Codex port of [claude-status-bar](https://github.com/m1ckc3s/claude-status-bar). If your idea is a port to yet another agent or platform (Linux, Windows, other CLIs), it almost certainly belongs in your own fork, not here. This app is Codex on macOS.

## What's welcome

Bug fixes, performance wins, animation and visual polish, better session focus, and compatibility fixes (macOS versions, CPU architectures, terminals, Codex versions). Keeping up with Codex's hook and rollout formats as they evolve is especially valuable.

## Won't be merged

- Sending your conversation, files, or project to any API or relay.
- Anything that costs money or needs an API key.
- Usage meters, cost dashboards, analytics, or telemetry.
- Heavy work in the hooks. They run synchronously on every event and block the turn, so they write one small state file and exit: no network, no per-prompt API calls. They must always exit 0 and never write JSON to stdout (Codex would interpret it as a block/deny decision).
- Hardcoding for one locale, provider, relay, or terminal.
- New settings stores or dependencies for a minor feature when what's already there works.
- Changing how your machine behaves: preventing sleep, holding power assertions, running privileged helpers, or any background action beyond showing status. The app displays state, it doesn't act on your system.
- Ports to Linux, Windows, or other agents. Great projects, but as your own fork.

## Building

You'll need macOS 12+, the Swift toolchain (Xcode Command Line Tools), Node.js (the hooks run on Node), and Codex CLI 0.145+.

```bash
./build.sh          # -> "build/Codex Status Bar.app"
./build.sh --dmg    # also builds a .dmg
```

Signing and notarization use the maintainer's Developer ID (`TEAM_ID` env var); without it you get an ad-hoc build, which is fine for testing. Launch it, start a Codex session, and the icon appears.

Build off the latest `main` so you're not fixing something that already changed.

## Testing

The runtime hooks, installer, and uninstaller have an automated suite (no dependencies,
just Node's own test runner). It runs against a throwaway `HOME`, never your real
`~/.codex`, and app launches and preference changes are stubbed:

```bash
node --test "tests/*.test.js"
bash tests/swift-tests.sh
```

Run the hook suite when changing `hooks/*.js`. The installer and uninstaller decide
whether Codex trusts the hooks at all, and a wrong `trusted_hash` fails silently.
The Swift suite tests rollout recovery, icon rasterization, Orbit timing and colors,
and text preference migration without launching the menu bar app. Use
`"build/Codex Status Bar.app/Contents/MacOS/CodexStatusBar" --render-frames build/frames`
to export all animation frames without starting the hook or session runtime.

Beyond that: before you open a PR, actually run it. "Builds clean" is not testing.

Test it on the surfaces you can, because they behave differently:

- the **CLI, in a terminal** (and name the terminal: Terminal.app, Ghostty, iTerm2, WezTerm, …),
- **`codex exec`** for the non-interactive path,
- the **Codex Desktop app / IDE extension** if you use them.

For any visual or timing change, attach a screenshot or a short screen recording.

## What to expect

This is a solo hobby project. Replies can be slow, and I may decline a perfectly good PR because it adds complexity or scope I don't want to carry. That's not a knock on your work. When in doubt keep the change small: some behavior that looks like a bug is intentional and already understood — timing, lifecycle, and self-quit especially.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `chore`, `refactor`, `style`, `docs`, `perf`. Branches: `type/kebab-case-description`.

## License

MIT. By contributing, you agree your contributions are licensed under it.
