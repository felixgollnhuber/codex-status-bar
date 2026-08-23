# Acknowledgements

Codex Status Bar is a fork of [claude-status-bar](https://github.com/m1ckc3s/claude-status-bar) by **[@m1ckc3s](https://github.com/m1ckc3s)**. The architecture — stateless app, hook-driven per-session state files, pid-based liveness, the self-opening/self-quitting lifecycle, and the menu UI — carries over from upstream essentially unchanged. Thank you for building and open-sourcing it.

The upstream contributors whose work lives on in this port:

- **[@BrennenRocks](https://github.com/BrennenRocks)**, [PR #13](https://github.com/m1ckc3s/claude-status-bar/pull/13): the per-session / multi-session implementation.
- **[@marcosarzuza](https://github.com/marcosarzuza)**, [PR #11](https://github.com/m1ckc3s/claude-status-bar/pull/11): the early multi-session precursor, plus multi-CLI testing and feedback.
- **[@angelo-swe](https://github.com/angelo-swe)**, [PR #17](https://github.com/m1ckc3s/claude-status-bar/pull/17): another take at multi-session and the priority-sorting menu design.
- **[@CXRommel](https://github.com/CXRommel)**, [PR #14](https://github.com/m1ckc3s/claude-status-bar/pull/14): multi-account support groundwork.
- **[@nacalorea](https://github.com/nacalorea)**, [PR #18](https://github.com/m1ckc3s/claude-status-bar/pull/18): the reminder to ship an Intel universal binary, not just Apple Silicon.
- **[@gingerbeardman](https://github.com/gingerbeardman)**, [issue #3](https://github.com/m1ckc3s/claude-status-bar/issues/3): an early bug report that pinned down the app quitting while the agent was still working.
- **[@ethan0905](https://github.com/ethan0905)**, [PR #37](https://github.com/m1ckc3s/claude-status-bar/pull/37): git branch names in the session rows and the parent-folder disambiguation for same-named projects, with a cheap no-git-spawn HEAD read.
- **[@moritzwendt](https://github.com/moritzwendt)**, [PR #34](https://github.com/m1ckc3s/claude-status-bar/pull/34): the build.sh fallback to an ad-hoc build when no Developer ID cert is installed.
- **[@Bardin08](https://github.com/Bardin08)**, [issue #44](https://github.com/m1ckc3s/claude-status-bar/issues/44): the root-cause analysis behind the self-heal (hooks relaunch the app).
- **[@pedrol2b](https://github.com/pedrol2b)**, [PR #48](https://github.com/m1ckc3s/claude-status-bar/pull/48): found the Homebrew-Node time bomb (a version-specific Node path pinned into the hooks) and started upstream's test suite; both shaped the 0.1.1 Node resolution and tests here.
- **[@Bardin08](https://github.com/Bardin08)**, [issue #53](https://github.com/m1ckc3s/claude-status-bar/issues/53): the profiler-backed CPU report behind upstream's 0.4.4 performance work, ported here in 0.1.3 (title redraw guard, frame cache, rollout tail cache).

Thanks as well to everyone who opened issues and pull requests upstream along the way.
