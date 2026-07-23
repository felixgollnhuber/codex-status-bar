# Changelog

All notable changes to Codex Status Bar are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
