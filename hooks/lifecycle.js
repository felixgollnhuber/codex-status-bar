#!/usr/bin/env node
// SessionStart/SessionEnd hooks. Usage: node lifecycle.js <start|end>  (hook JSON, incl. session_id, on stdin)
//
// Same contract as update.js: hooks run synchronously, so never write to stdout,
// always exit 0, and exit fast (SessionEnd is hard-capped at 3s by Codex).

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const BUNDLE_ID = "com.local.codexstatusbar";
const EXEC = "CodexStatusBar";
const dir = path.join(os.homedir(), ".codex", "statusbar");
const stateDir = path.join(dir, "state.d");
const event = process.argv[2];

const running = () => { try { cp.execFileSync("pgrep", ["-x", EXEC], { stdio: "ignore" }); return true; } catch { return false; } };
const safeId = (s) => typeof s === "string" ? s.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) : "";
// Same liveness probe the app uses: the session's codex process exists (EPERM = exists,
// not ours — still alive).
const pidAlive = (pid) => {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};

const CODEX_APP_BUNDLE = "com.openai.codex";
function surface() {
  const bundle = process.env.__CFBundleIdentifier || "";
  const term = process.env.TERM_PROGRAM || "";
  if (bundle === CODEX_APP_BUNDLE) return { entrypoint: "app", termProgram: "" };
  return { entrypoint: "cli", termProgram: term || (bundle === "com.microsoft.VSCode" ? "vscode" : "") };
}

const writeAtomic = (file, obj) => {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
};

let input = "", done = false;
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => run());
process.stdin.on("error", () => run());
setTimeout(run, 800); // hooks always pipe stdin, but never hang the session

function run() {
  if (done) return; done = true;
  try { main(); } catch {}
  process.exit(0);
}

function main() {
  let id = "", cwd = "", transcript = "", source = "";
  try { const j = JSON.parse(input); id = j.session_id; cwd = j.cwd || ""; transcript = j.transcript_path || ""; source = j.source || ""; } catch { return; }
  id = safeId(id);
  if (!id) return;
  const statePath = path.join(stateDir, id + ".json");

  if (event === "start") {
    // Compaction re-fires SessionStart (source:"compact") mid-turn — no new session
    // was opened, so leave quit-intent alone, don't relaunch, and don't clobber the
    // live working state with an idle seed.
    if (source === "compact") return;
    try { fs.mkdirSync(stateDir, { recursive: true }); } catch {}
    // A new session voids a prior explicit Quit (see update.js's self-relaunch suppress).
    try { fs.rmSync(path.join(dir, "quit-intent"), { force: true }); } catch {}
    // If the app isn't running, leftover session files may be stale (e.g. a prior
    // crash) — but only files whose codex process is GONE are actually stale. Files
    // with a live pid belong to running sessions (app quit by hand, or a second
    // session starting in the same launch window) and must survive the sweep.
    if (!running()) {
      try {
        for (const f of fs.readdirSync(stateDir)) {
          const fp = path.join(stateDir, f);
          if (f.endsWith(".json")) {
            try {
              if (pidAlive(JSON.parse(fs.readFileSync(fp, "utf8")).pid | 0)) continue;
            } catch {} // unreadable -> treat as stale
          } else {
            // Could be another live session's in-flight *.tmp between writeFileSync
            // and renameSync; only reap it once it is clearly orphaned.
            try { if (Date.now() - fs.statSync(fp).mtimeMs < 10000) continue; } catch {}
          }
          fs.rmSync(fp, { force: true });
        }
      } catch {}
    }
    // Seed an idle file: counts the session immediately, and clears any frozen state from a
    // resume (SessionStart fires on resume with no active turn).
    const s = surface();
    try {
      // started:false — a merely-opened conversation seeds this for launch + liveness but stays out of
      // the dropdown until it has real activity (update.js flips started:true on a prompt/tool).
      writeAtomic(statePath, { state: "idle", label: "", tool: "", project: cwd ? path.basename(cwd) : "", cwd, sessionId: id, transcript, entrypoint: s.entrypoint, term_program: s.termProgram, pid: process.ppid, started: false, startedAt: 0, ts: Math.floor(Date.now() / 1000) });
    } catch {}
    cp.spawn("open", ["-g", "-b", BUNDLE_ID], { stdio: "ignore", detached: true }).unref();
  } else if (event === "end") {
    // Removing the file drops this session from the aggregate — this is also what recovers a
    // frozen animation on force-quit (SessionEnd fires, but no Stop). No state rewrite needed.
    try { fs.rmSync(statePath, { force: true }); } catch {}
  }
}
