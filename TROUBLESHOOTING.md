# Troubleshooting

**You don't open this app, it opens itself.** The only time you launch it by hand is once, right after install, so it can wire up the Codex hooks. After that it starts itself whenever a Codex session is running and quits when none is left. So opening it from Finder or Spotlight with no session active can look like it launches and immediately quits. That is expected, not a crash: just start a Codex session and the icon appears on its own. Upgrades self-heal: drop the new version into Applications and it refreshes its own hooks the next time it starts up.

**Installed while Codex sessions were already running?** Sessions already open appear the next time they do something (a prompt or a tool call), so the menu can look empty until then. Starting a new `codex` session also works.

**Codex is older than 0.145?** This app rides on Codex's native hooks system. On older versions the hooks never fire and the icon never appears. Update with `codex update` (or `brew upgrade codex`).

**Icon stuck on "working" after you interrupted?** If you press Esc mid-turn, Codex fires no hook for the abort. The app recovers on its own by reading the session's rollout file (the `turn_aborted` marker), usually within a second. If a session somehow stays stuck anyway, it times out after about 15 minutes, and any new prompt clears it right away.

**The icon doesn't appear at all?**
- Make sure a Codex session is actually running, not just a terminal window open. Start a new session and the bar appears automatically.
- A session that was already running *before* you installed won't show up until it does something (or you start a fresh session).
- Confirm the app is running with `pgrep -x CodexStatusBar`: a number means it's running (it may just be resting), no output means it exited because no Codex session is active.
- Check that the hooks are registered and trusted: `~/.codex/hooks.json` should contain entries pointing at `~/.codex/statusbar/`, and `~/.codex/config.toml` should contain the marked `codex-status-bar hooks trust` block. If either is missing, run the installer manually:
  `node "/Applications/Codex Status Bar.app/Contents/Resources/install.js"`
- Debug what the hooks see: run a session with `CODEX_STATUSBAR_DEBUG=1` in the environment and check `~/.codex/statusbar/hooks.log`.

**Hooks listed as untrusted in Codex?** If you edit the hook commands in `~/.codex/hooks.json` by hand, their `trusted_hash` no longer matches and Codex silently stops running them. Re-run the installer (it recomputes the hashes), or approve them in Codex's hooks review.

**Seeing 2 icons?** If you also run a Codex usage app (e.g. CodexBar), that's a different app with a different job — usage and quotas there, live session status here. They coexist fine.

---
Back to the [README](README.md).
