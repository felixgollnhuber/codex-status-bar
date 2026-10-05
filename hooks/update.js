#!/usr/bin/env node
// Maps a Codex hook event to this session's file: ~/.codex/statusbar/state.d/<session_id>.json
// Usage: node update.js <prompt|pre|post|permreq|stop>   (hook JSON on stdin)
//
// Codex runs hooks synchronously ($SHELL -lc) and interprets exit code 2 or JSON on
// stdout as a decision (block/deny). This script therefore NEVER writes to stdout and
// ALWAYS exits 0, no matter what goes wrong.

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const dir = path.join(os.homedir(), ".codex", "statusbar");
const stateDir = path.join(dir, "state.d");
// Written by the app's Quit menu item; suppresses the relaunch below so Quit sticks.
// lifecycle.js removes it on the next SessionStart (a new session = fresh consent).
const quitMarker = path.join(dir, "quit-intent");
const event = process.argv[2] || "";

// Canonical hook tool names -> short menu bar labels. Codex's hook engine reports
// every shell-like tool as "Bash" (core/src/tools/hook_names.rs); patches keep their
// real name "apply_patch"; MCP tools arrive as "mcp__<server>__<tool>"; the rest
// pass through flat (update_plan, web_search, …).
const TOOL_LABELS = {
  Bash: "Running command",
  apply_patch: "Editing",
  read_file: "Reading", view_image: "Reading", list_dir: "Reading",
  grep: "Searching", glob: "Searching",
  web_search: "Searching web", browser: "Browsing web", fetch: "Browsing web",
  update_plan: "Planning",
  spawn_agent: "Delegating", wait_agent: "Delegating", send_message: "Delegating",
  list_agents: "Delegating", close_agent: "Delegating",
};

const safeId = (s) => typeof s === "string" ? s.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) : "";

// Codex Desktop launches `codex` as a GUI child, so hooks inherit macOS's
// __CFBundleIdentifier; terminal sessions carry TERM_PROGRAM instead.
const CODEX_APP_BUNDLE = "com.openai.codex";
function surface() {
  const bundle = process.env.__CFBundleIdentifier || "";
  const term = process.env.TERM_PROGRAM || "";
  if (bundle === CODEX_APP_BUNDLE) return { entrypoint: "app", termProgram: "" };
  return { entrypoint: "cli", termProgram: term || (bundle === "com.microsoft.VSCode" ? "vscode" : "") };
}

function finish() { process.exit(0); }

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("error", () => {});
process.stdin.on("end", () => { try { run(); } catch {} finish(); });
// Codex always pipes and closes stdin, but never risk hanging (hooks block the turn).
setTimeout(finish, 2000).unref?.();

function run() {
  let p;
  try { p = JSON.parse(raw); } catch { return; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return;
  const sid = safeId(p.session_id);
  // No anonymous fallback: a malformed payload must not overwrite another
  // session's state or relaunch the app.
  if (!sid) return;

  // Off by default; CODEX_STATUSBAR_DEBUG=1 logs every hook invocation to hooks.log.
  if (process.env.CODEX_STATUSBAR_DEBUG === "1") {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "hooks.log"),
        `${new Date().toISOString()} [${event}] tool=${p.tool_name || "-"} mode=${p.permission_mode || "-"} keys=${Object.keys(p).join(",")}\n`);
    } catch {}
  }

  // This session's own file is the unit of state AND the liveness marker. Writing it on any
  // event also tracks sessions that predate the hook install (never fired SessionStart).
  const statePath = path.join(stateDir, sid + ".json");

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}

  const project = p.cwd ? path.basename(p.cwd) : prev.project || "";
  // The app reads <cwd>/.git/HEAD for the branch and disambiguates same-named projects by
  // parent folder; carried over from prev for events whose payload omits cwd.
  const cwd = p.cwd || prev.cwd || "";
  const ts = Math.floor(Date.now() / 1000);
  let state = "idle", label = "", startedAt = prev.startedAt || 0;

  switch (event) {
    case "prompt":
      state = "thinking"; label = "Working…"; startedAt = ts; break;
    case "pre": {
      const t = p.tool_name || "";
      // request_user_input is Codex asking YOU a question mid-turn — that's an
      // attention state (amber dot), not a working state.
      if (t === "request_user_input") {
        state = "permission"; label = "Awaiting your input"; startedAt = 0; break;
      }
      state = "tool"; label = TOOL_LABELS[t] || "Using tool";
      if (!startedAt) startedAt = ts;
      break;
    }
    case "post":
      state = "thinking"; label = "Working…";
      if (!startedAt) startedAt = ts;
      break;
    case "permreq":
      // PermissionRequest fires in the approval path, right before Codex shows its
      // approval UI (CLI and Desktop alike). We record the state and decide nothing.
      state = "permission"; label = "Awaiting permission"; startedAt = 0; break;
    case "stop":
      state = "done"; label = "Done"; startedAt = 0; break;
    default:
      return;
  }

  // Subagents fire the same hooks with the parent's session_id (agent_id set), so one
  // state file is shared by concurrent lanes. Track WHICH lanes have an approval
  // pending: a tool event from some other lane must not clear the amber state (that
  // lane cannot know the approval resolved), and with several approvals pending the
  // state stays amber until every requesting lane has moved on. prompt (the user
  // acted) and stop (turn over) always clear the set.
  const lane = p.agent_id || "";
  const isNewPermReq = event === "permreq" || (event === "pre" && (p.tool_name || "") === "request_user_input");
  let lanes = Array.isArray(prev.lanes) ? prev.lanes.slice() : (prev.state === "permission" ? [""] : []);
  if (event === "prompt" || event === "stop") lanes = [];
  else if (isNewPermReq) { if (!lanes.includes(lane)) lanes.push(lane); }
  else if (event === "pre" || event === "post") lanes = lanes.filter((l) => l !== lane);
  if ((event === "pre" || event === "post") && !isNewPermReq && lanes.length) {
    state = "permission"; label = prev.label || "Awaiting permission"; startedAt = 0;
  }

  const s = surface();
  const entrypoint = s.entrypoint || prev.entrypoint || "";
  const termProgram = s.termProgram || prev.term_program || "";
  // The hook command is `exec node …`, so the login shell Codex spawns replaces itself
  // with this process and process.ppid IS the session's `codex` process. The app uses
  // kill(pid,0) for liveness. started:true — any update.js event is real activity.
  const out = { state, label, tool: p.tool_name || "", project, cwd, sessionId: p.session_id || "", transcript: p.transcript_path || prev.transcript || "", entrypoint, term_program: termProgram, pid: process.ppid, started: true, startedAt, ts, lanes: state === "permission" ? lanes : [] };
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = statePath + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, statePath);
  } catch {}

  // Self-heal: a session with live state but no app to show it relaunches the app. Covers
  // install-while-a-session-is-already-open (that session never fires SessionStart, the only
  // other opener) and an app killed/crashed mid-session. Skipped after an explicit menu Quit.
  try {
    if (!fs.existsSync(quitMarker)) {
      cp.execFileSync("pgrep", ["-x", "CodexStatusBar"], { stdio: "ignore" });
    }
  } catch {
    try { cp.spawn("open", ["-g", "-b", "com.local.codexstatusbar"], { stdio: "ignore", detached: true }).unref(); } catch {}
  }
}
