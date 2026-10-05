# Changelog

All notable changes to Codex Status Bar are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.1.4] - 2026-10-05

### Fixed
- Refused installs leave existing hook commands intact when the trust block is incomplete or malformed. Uninstall checks every recorded home's hooks and trust block before changing hooks, trust entries, or the running app.
- Disabled hooks remain disabled when `enabled = false` has an inline TOML comment.
- Malformed runtime hook input and missing session ids no longer create, overwrite, or delete an anonymous session file.
- Rollout recovery reads the actual event payload, accepts Codex's v2 turn aliases, and ignores nested marker lookalikes and partial JSON records.
- Scaled Blue glyphs retain transparent padding instead of leaving a colored border around the resting prompt.

### Added
- **Orbit animation**, ported from upstream 0.4.5. Three dots orbit and breathe in Codex Blue or adaptive System color, with entrance and exit transitions to the `>_` prompt. Existing animation selections are preserved.
- macOS Reduce Motion support for the menu bar working indicator and session-row spinners.
- Regression coverage for runtime session transitions, approval lanes, quit intent, compaction, startup cleanup, malformed input, config refusal, and rollout parsing. Swift recovery tests run in CI alongside the hook suite and universal build.

### Changed
- Cached animation frames, the resting prompt, and the permission dot are now materialized as Retina bitmaps once. This ports the remaining rendering optimization from upstream 0.4.5 (`dc4cf880`) while preserving the Codex icons, colors, and animation choices.
- **Show text** replaces **Thinking words** and also controls attention labels. The previous preference carries over, the timer remains independent, and tooltips retain their status descriptions.
- `--render-frames` includes Orbit's full entrance, loop, and exit plus its System variant. Export no longer starts session polling, installs hooks, changes preferences, or checks for updates.

## [0.1.3] - 2026-08-23

### Added
- **Completion Sound has an "Every turn" option.** The chime can now play the moment any turn finishes, instead of only after turns of a minute or longer. Still off by default. (Upstream 0.4.3.)

### Changed
- **Lower CPU usage.** Three fixes ported from upstream 0.4.4 ([#53](https://github.com/m1ckc3s/claude-status-bar/issues/53), found by [@Bardin08](https://github.com/Bardin08)): the menu bar title is no longer rebuilt and re-rendered on every animation frame (it only changes once a second); animation frames, the resting `>_` and the amber dot are rasterized once and cached instead of being redrawn on every step or poll; and each session's rollout is only re-read when its mtime actually changes rather than 2.5 times a second per session. Upstream's fourth fix (observing the desktop app instead of querying it on every poll) was never needed here — this port only asks when you open the menu.

## [0.1.2] - 2026-07-31

### Changed
- **The DMG is now signed with a Developer ID and notarized by Apple.** Earlier releases were ad-hoc signed, so macOS refused them outright — on macOS 15 and later with the harshest wording it has ("is damaged … move it to the Trash"), and without offering the old right-click → Open way around it. This release opens by double-clicking it, like anything else.

## [0.1.1] - 2026-07-31

### Fixed
- **Hooks survive Node version-manager upgrades.** The installer already preferred a stable Node path over the versioned one (upstream's [0.4.2 fix](https://github.com/m1ckc3s/claude-status-bar/blob/main/CHANGELOG.md), found there by [@pedrol2b](https://github.com/pedrol2b), never applied here). It now also knows mise, MacPorts and Nix, and where no stable path exists — nvm and fnm have none — the hook commands resolve `node` through the same login shell Codex runs them in, so they re-resolve on every run instead of pinning a path that the next upgrade deletes.
- **Hook commands are quoted against shell expansion.** Paths were wrapped in double quotes, so a `$` or a backtick anywhere in your home path would have been expanded by the shell Codex runs hooks in. They now use single quotes, which suppress every expansion in sh, zsh, bash and fish alike.
- **A `CODEX_HOME` that doesn't exist yet no longer crashes the installer** — it is created. A custom home you have since deleted is dropped from the manifest instead of being recreated.

### Added
- Automated tests for the installer and uninstaller (`node --test "tests/*.test.js"`, no dependencies), covering the Node resolution branches, merging into an existing `hooks.json` without shifting anyone's trust indices, the `trusted_hash` recipe, and surgical uninstalls. They run in CI on every push and pull request.

## [0.1.0] - 2026-07-23

Initial release — a Codex port of [claude-status-bar 0.4.1](https://github.com/m1ckc3s/claude-status-bar/blob/main/CHANGELOG.md), rebuilt on Codex CLI's native hooks system (0.145+).

### Added
- Live menu bar status for Codex sessions: animated icon while working or running a tool, amber dot while awaiting your approval, elapsed-time clock, multi-session dropdown with project, git branch, and per-session timers.
- Hook integration via `~/.codex/hooks.json` (SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop). The installer merges additively — hooks you added yourself keep their positions and trust — and pre-trusts exactly its own hooks with `trusted_hash` entries in a clearly marked block in `~/.codex/config.toml`. The `notify` setting is never touched.
- `request_user_input` (Codex asking you a question mid-turn) surfaces as an attention state: amber dot, "Awaiting your input".
- Interrupt recovery: an Esc mid-turn fires no hook, so the app reads the session rollout's `turn_aborted` marker and rests the icon on its own.
- Seven code-rendered animation styles — Dots (braille spinner), Pulse (breathing dot, like the Codex TUI's shimmer), Cursor (blinking `>_` prompt), Ellipsis (typing dots), Bars (terminal equalizer), Scanner (sweeping segment), Shimmer (highlight travelling across dots) — plus a `>_` resting icon and a code-rendered app icon. No bundled sprite assets. (`CodexStatusBar --render-frames <dir>` dumps preview frames.)
- Icon color Blue or System (adaptive), optional completion chime for long turns.
- "Thinking words" off (default) keeps the bar icon-only and silent; on, it shows a rotating verb while thinking and the tool label while a tool runs.
- Session surfaces: terminal CLI (with terminal-app focus on row click), VS Code/editor sessions, the Codex Desktop app (APP pill; row click focuses the app), and `codex exec`.

### Changed from upstream
- All state lives under `~/.codex/statusbar/` instead of `~/.claude/statusbar/`.
- Liveness, self-open, and self-quit ride on Codex process pids and session files only; the app no longer stays alive just because the desktop app is open (ChatGPT.app carries the Codex bundle id and often runs all day).
- Hook scripts run synchronously inside Codex's turn, so they are hardened to always exit 0 and never write to stdout (Codex would interpret output as a block/deny decision).
