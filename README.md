

A tiny macOS menu bar app that shows **Codex's live status**: an animated icon while it's working or running a tool, a yellow dot when it's awaiting your approval, and the elapsed time of the current turn. Lightweight, no window, no dock icon, no usage dashboards.

Built so you can tab away during a long turn and still see, at a glance, whether Codex is working, waiting on you, or done.

> This is a Codex port of [m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar). Same idea, same architecture — rebuilt on the native hooks system that ships with Codex CLI.

## Install

1. Download the latest `CodexStatusBar.dmg` from [Releases](../../releases) (or build from source: `./build.sh`).
2. Open it and drag **Codex Status Bar** into Applications.
3. Launch it once. On first launch it wires up the Codex hooks for you automatically.
4. Start a new Codex session — the icon appears whenever Codex is running.

(Homebrew distribution is prepared but not live yet — the app will start offering brew commands on its own once a cask exists.)

> [!IMPORTANT]
> **Installed mid-session?** Sessions already open appear the next time they do something (a prompt or a tool call). Starting a new `codex` session also works.

## Requirements

- macOS 12+
- [Codex CLI](https://developers.openai.com/codex/cli) **0.145 or newer** (the native hooks system must be available), or the Codex Desktop app / IDE extension built on it
- Node.js (the hooks run on Node)

## What it shows

- **Working** — the icon animates, with a live `1m 1s` timer.
- **Running a tool** — a short label (`Running command`, `Editing`, `Searching web`, …).
- **Awaiting permission** — a paused yellow dot, also when Codex asks you a question mid-turn (`request_user_input`).
- **Idle / done** — rests on a `>_` prompt.

Everything is controlled from the menu:

- **Show timer:** toggle the elapsed `1m 1s` clock.
- **Show text:** off by default for an icon-only bar. On, it shows a rotating playful verb (`Manifesting…`, `Percolating…`) while thinking, the tool label while a tool runs, and the attention label while waiting for you. The timer is independent, and status descriptions remain available on hover. Your previous "Thinking words" setting carries over.
- **Animation:** **Dots** (braille spinner), **Pulse** (breathing dot, like the Codex TUI's shimmer), **Cursor** (a blinking `>_` prompt), **Ellipsis** (typing dots), **Bars** (terminal equalizer), **Scanner** (sweeping progress segment), **Shimmer** (a highlight travelling across dots), or **Orbit** (three dots that merge, orbit, and breathe, blending back to `>_` when the turn finishes).
- **Reduce Motion:** the macOS accessibility setting keeps the working indicator static and stops session-row spinners.
- **Color:** **Blue** or **System** (adaptive black/white).
- **Completion sound:** an optional chime when a turn finishes — every turn, or only after turns of 1/5/15 min or longer.
- **Version and update:** the menu shows your current version and tells you when an update is ready.

### Where it works

| Surface | Tracked? |
|---|---|
| Codex CLI (terminal) | ✅ |
| Codex in VS Code / editors | ✅ |
| Codex Desktop app (ChatGPT app) | ✅ |
| `codex exec` (non-interactive) | ✅ |

**Multi-session support.** When several Codex sessions run at once (multiple terminals, or a terminal plus the desktop app), the menu bar surfaces the highest-priority one: a session awaiting your approval is never hidden behind one that's merely working. The dropdown lists every live session with its project, git branch, and elapsed time.

## How it works

> [!NOTE]
> You don't open this app; it opens itself when a Codex session starts, and quits when none is left. The only manual launch is the very first one after install, to set up the hooks. Opened by hand with no session active, it quits again after a few seconds. That's normal.

The app is stateless. Codex fires hooks as it works ([native hooks, Codex 0.145+](https://github.com/openai/codex)); each hook writes one small per-session state file under `~/.codex/statusbar/`, and the app polls those files and aggregates them across every live session into a single icon — a permission dot if one needs you, animating if any session is working, resting when all are idle.

The installer registers its hooks in `~/.codex/hooks.json` (merging, never touching hooks you added yourself) and pre-trusts exactly those hooks with `trusted_hash` entries in `~/.codex/config.toml`, inside a clearly marked block. Both files are backed up on first run (`*.bak-statusbar`). Your `notify` setting is never touched. The app's only network activity is a once-a-day update check against GitHub's and Homebrew's public APIs ([details](PRIVACY.md)).

## Updating

The menu tells you when an update is ready and opens the releases page. Download the new DMG and drag it into Applications — hooks refresh themselves on the next launch; nothing to run by hand.

## Troubleshooting

Icon not appearing, vanishing on its own, or not animating when it should? See [Troubleshooting](TROUBLESHOOTING.md) — most of it is expected behavior, not a bug.

## Uninstall

```bash
node "/Applications/Codex Status Bar.app/Contents/Resources/uninstall.js"
```

removes the hooks, the trust entries, and `~/.codex/statusbar`; then drag the app to the Trash.

## Acknowledgements

This app is a fork of [claude-status-bar](https://github.com/m1ckc3s/claude-status-bar) by [@m1ckc3s](https://github.com/m1ckc3s), whose design (stateless app, hook-driven per-session state files, pid-based liveness, self-opening/self-quitting lifecycle) carries over essentially unchanged. **[See the contributors →](ACKNOWLEDGEMENTS.md)**

## Trademark / Not Affiliated

This is an unofficial, open-source side project. **It is not affiliated with, endorsed by, or sponsored by OpenAI.** "Codex" and "ChatGPT" are trademarks of OpenAI, used here nominatively. This project is MIT licensed, but that covers the source code only and conveys no rights to OpenAI's trademarks or brand.

## License

MIT
