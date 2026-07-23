#!/usr/bin/env node
// Installs the status-bar hooks for Codex CLI (>= 0.145, hooks feature):
//   1. Copies update.js + lifecycle.js to ~/.codex/statusbar/.
//   2. Registers them in $CODEX_HOME/hooks.json — merging by UPSERT: an existing group
//      of ours is replaced in place, so neither our nor anyone else's group indices
//      ever shift (indices are baked into [hooks.state] trust keys).
//   3. Pre-trusts our hooks by writing trusted_hash entries into $CODEX_HOME/config.toml
//      inside a clearly marked block (Codex only runs hooks whose normalized identity
//      hash matches a [hooks.state."<file>:<event>:<group>:<handler>"] entry).
// Re-runnable; refreshes EVERY Codex home recorded in the manifest (the app re-runs
// this without CODEX_HOME set). The legacy `notify` setting is never touched.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

const home = os.homedir();
const envHome = process.env.CODEX_HOME || "";
const defaultHome = path.join(home, ".codex");
const sbDir = path.join(home, ".codex", "statusbar"); // state lives here even with a custom CODEX_HOME (the app reads this path)
const MARKER = sbDir; // every hook command we add points inside this dir
const updateDest = path.join(sbDir, "update.js");
const lifecycleDest = path.join(sbDir, "lifecycle.js");
const manifestPath = path.join(sbDir, "install-manifest.json");

const BLOCK_BEGIN = "# >>> codex-status-bar hooks trust (managed block, do not edit) >>>";
const BLOCK_END = "# <<< codex-status-bar hooks trust <<<";

// Prefer a STABLE node path over process.execPath: execPath resolves Homebrew's
// symlink into the versioned Cellar (…/Cellar/node/26.5.0/bin/node), which dies on
// the next `brew upgrade node` and would silence the hooks until the app reinstalls
// them. Candidates are validated by actually running them (catches dead symlinks,
// wrong-arch binaries, broken shims, and pre-14.14 versions lacking fs.rmSync).
function nodeWorks(bin) {
  try {
    cp.execFileSync(bin, ["-e", 'require("fs").rmSync ?? process.exit(1)'], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch { return false; }
}
function stableNode() {
  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    path.join(home, ".volta", "bin", "node"),
    path.join(home, ".asdf", "shims", "node"),
  ];
  for (const c of candidates) {
    try { fs.accessSync(c, fs.constants.X_OK); } catch { continue; }
    if (nodeWorks(c)) return c;
  }
  return process.execPath; // the node running this installer — known good
}
const node = stableNode();

// --- trusted_hash recipe (verified byte-for-byte against codex-rs discovery.rs) ---

const EVENT_LABELS = {
  PreToolUse: "pre_tool_use", PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use", PreCompact: "pre_compact", PostCompact: "post_compact",
  SessionStart: "session_start", SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit", SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop", Stop: "stop",
};
// Events whose handlers may declare additionalContextLimit (elsewhere Codex drops it).
const CONTEXT_EVENTS = new Set(["PreToolUse", "PostToolUse", "SessionStart", "UserPromptSubmit", "SubagentStart"]);

// Compact JSON with recursively sorted keys — matches serde_json's output for the
// normalized identity (ASCII paths; serde_json and JSON.stringify escape identically here).
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

// Normalized per-handler identity, mirroring Codex's discovery normalization:
// timeout defaulted (600s, min 1; SessionEnd default 1, clamped 1..3); async always
// present; statusMessage only if set; additionalContextLimit only for context events
// and != the 2500 default; the GROUP's matcher included except for UserPromptSubmit
// and Stop, where Codex ignores matchers. Our own groups set none of the extras, but
// a hand-edited mixed group may — hash exactly what Codex will hash.
function trustedHash(event, hd, matcher) {
  const t = event === "SessionEnd"
    ? Math.min(Math.max(hd.timeout ?? 1, 1), 3)
    : Math.max(hd.timeout ?? 600, 1);
  const handler = { type: "command", command: hd.command, timeout: t, async: hd.async === true };
  if (hd.statusMessage != null) handler.statusMessage = hd.statusMessage;
  if (CONTEXT_EVENTS.has(event) && hd.additionalContextLimit != null && hd.additionalContextLimit !== 2500) {
    handler.additionalContextLimit = hd.additionalContextLimit;
  }
  const identity = { event_name: EVENT_LABELS[event], hooks: [handler] };
  if (typeof matcher === "string" && event !== "UserPromptSubmit" && event !== "Stop") identity.matcher = matcher;
  const bytes = Buffer.from(stableStringify(identity), "utf8");
  return "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
}

// --- hook set ---

// Double quotes work identically for plain paths in sh/bash/zsh/fish (Codex runs hooks
// via `$SHELL -lc`). `exec` makes the shell replace itself with node, so process.ppid
// inside the script is the session's `codex` process (liveness contract with the app).
const cmd = (script, evt) => `exec "${node}" "${script}" ${evt}`;

const HOOKS = [
  { event: "SessionStart", command: cmd(lifecycleDest, "start") },
  { event: "SessionEnd", command: cmd(lifecycleDest, "end"), timeout: 3 },
  { event: "UserPromptSubmit", command: cmd(updateDest, "prompt") },
  { event: "PreToolUse", command: cmd(updateDest, "pre") },
  { event: "PostToolUse", command: cmd(updateDest, "post") },
  { event: "PermissionRequest", command: cmd(updateDest, "permreq") },
  { event: "Stop", command: cmd(updateDest, "stop") },
];

// --- helpers ---

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isOurHandler = (h) => isPlainObject(h) && typeof h.command === "string" && h.command.includes(MARKER);
const hasOurHandler = (g) => isPlainObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHandler);
// "Ours" = every handler is ours. A mixed group (user edited handlers into ours) is
// never replaced or removed — user content is not ours to destroy.
const isOurs = (g) => isPlainObject(g) && Array.isArray(g.hooks) && g.hooks.length > 0 && g.hooks.every(isOurHandler);

function writeAtomic(file, text) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function backupOnce(file) {
  const bak = file + ".bak-statusbar";
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

// Strip a previously written managed block plus any stray [hooks.state] sections for
// keys we own. Own-key sections outside the block drop only the value lines we (or
// the Codex TUI trust review) write — trusted_hash / enabled — while comments are
// kept WITHOUT ending the section, so a value line after a comment can't leak into
// the preceding table (invalid TOML). Matching is byte-exact against the canonical
// header spelling both we and the Codex TUI write; hand-reformatted headers are left
// alone by design. Returns null if the block begin marker has no end marker — the
// caller must then refuse to touch the file (everything below the orphaned marker
// would otherwise be swallowed).
function stripOurTrustEntries(toml, ownKeys) {
  const lines = toml.split("\n");
  const out = [];
  const disabled = new Set();
  const ownHeaders = new Map(ownKeys.map((k) => [`[hooks.state.${JSON.stringify(k)}]`, k]));
  let inBlock = false, skipKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === BLOCK_BEGIN) { inBlock = true; skipKey = null; continue; }
    if (trimmed === BLOCK_END) { inBlock = false; skipKey = null; continue; }
    const ownKey = trimmed.startsWith("[") ? (ownHeaders.get(trimmed) ?? null) : null;
    if (inBlock) {
      // Inside our managed block everything is ours — drop it, but harvest opt-outs.
      if (ownKey !== null) skipKey = ownKey;
      if (skipKey !== null && /^enabled\s*=\s*false\s*$/.test(trimmed)) disabled.add(skipKey);
      continue;
    }
    if (ownKey !== null) { skipKey = ownKey; continue; }
    if (skipKey !== null) {
      if (/^trusted_hash\s*=/.test(trimmed) || /^enabled\s*=/.test(trimmed) || trimmed === "") {
        if (/^enabled\s*=\s*false\s*$/.test(trimmed)) disabled.add(skipKey);
        continue;
      }
      if (trimmed.startsWith("#")) { out.push(line); continue; } // comment: keep it, stay in our section
      skipKey = null; // a new section header (or a key we never write) ends our section
    }
    out.push(line);
  }
  if (inBlock) return null; // orphaned begin marker — do not touch this file
  return { text: out.join("\n"), disabled };
}

// --- 1. copy scripts ---

fs.mkdirSync(sbDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, "update.js"), updateDest);
fs.copyFileSync(path.join(__dirname, "lifecycle.js"), lifecycleDest);

// --- manifest (multi-install registry, keyed by codex home) ---

let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
let installs = {};
if (isPlainObject(manifest.installs)) {
  installs = manifest.installs;
} else if (typeof manifest.hooksJsonPath === "string") {
  // v1 manifest: single install record
  installs[path.dirname(manifest.hooksJsonPath)] = {
    hooksJsonPath: manifest.hooksJsonPath,
    configTomlPath: manifest.configTomlPath,
    createdHooksJson: manifest.createdHooksJson === true,
    stateKeys: manifest.stateKeys || [],
  };
}

// Refresh every recorded home; add the env-derived home when CODEX_HOME is explicitly
// set or nothing is recorded yet (an env-less app relaunch must not seed ~/.codex for
// a user who only ever installed into a custom home).
const targets = new Set(Object.keys(installs));
if (envHome || targets.size === 0) targets.add(envHome || defaultHome);

let failures = 0;

function installInto(codexHome, prevEntry) {
  const hooksJsonPath = path.join(codexHome, "hooks.json");
  const configTomlPath = path.join(codexHome, "config.toml");
  const fail = (msgs) => { for (const m of msgs) console.error(m); failures++; return null; };

  // --- hooks.json: validate strictly, then upsert in place (indices never shift) ---
  let hooksFile = { hooks: {} };
  let createdHooksJson = true;
  if (fs.existsSync(hooksJsonPath)) {
    createdHooksJson = prevEntry.createdHooksJson === true; // carry forward: we may have created it earlier
    backupOnce(hooksJsonPath);
    try {
      hooksFile = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
    } catch (e) {
      return fail([`ERROR: ${hooksJsonPath} exists but is not valid JSON (${e.message}).`,
                   "Not touching it. Fix or remove the file, then re-run this installer."]);
    }
  }
  if (!isPlainObject(hooksFile) || (hooksFile.hooks != null && !isPlainObject(hooksFile.hooks))
      || (hooksFile.description != null && typeof hooksFile.description !== "string")) {
    return fail([`ERROR: ${hooksJsonPath} has an unexpected shape; not touching it.`]);
  }
  const unknownKeys = Object.keys(hooksFile).filter((k) => k !== "description" && k !== "hooks");
  if (unknownKeys.length) {
    return fail([`ERROR: ${hooksJsonPath} has top-level key(s) Codex rejects (${unknownKeys.join(", ")});`,
                 "Codex would skip the whole file. Fix or remove them, then re-run this installer."]);
  }
  hooksFile.hooks = hooksFile.hooks || {};
  for (const evt of Object.keys(hooksFile.hooks)) {
    const groups = hooksFile.hooks[evt];
    if (groups != null && !Array.isArray(groups)) {
      return fail([`ERROR: ${hooksJsonPath} has an unexpected shape ("hooks".${JSON.stringify(evt)} is not an array); not touching it.`]);
    }
    for (const g of groups || []) {
      if (!isPlainObject(g) || (g.hooks != null && !Array.isArray(g.hooks))) {
        return fail([`ERROR: ${hooksJsonPath} has a malformed matcher group under ${JSON.stringify(evt)}; Codex would skip the whole file. Fix it, then re-run this installer.`]);
      }
    }
  }

  for (const h of HOOKS) {
    const groups = hooksFile.hooks[h.event] || [];
    const handler = { type: "command", command: h.command };
    if (h.timeout != null) handler.timeout = h.timeout;
    const group = { hooks: [handler] };
    const idx = groups.findIndex(isOurs);
    if (idx !== -1) {
      groups[idx] = group; // replace in place — nobody's index moves
    } else if (groups.some(hasOurHandler)) {
      // A mixed group contains our command among user handlers — leave the user's
      // structure alone; the trust scan below still trusts our handler where it sits.
      console.log(`note: ${h.event} in ${hooksJsonPath} has a hand-edited group containing our hook; leaving it in place.`);
    } else {
      groups.push(group);
    }
    hooksFile.hooks[h.event] = groups;
  }
  // Top-level hooks.json is strict (only "description" + "hooks" allowed) — keep it minimal.
  if (createdHooksJson) hooksFile.description = hooksFile.description || "Codex Status Bar hooks (managed by the installer; safe to edit other entries)";
  writeAtomic(hooksJsonPath, JSON.stringify(hooksFile, null, 2) + "\n");

  // Trust entries are derived from the FINAL file positions, so they are correct
  // wherever our handlers ended up (upserted, appended, or inside a mixed group).
  // async:true handlers outside SessionEnd are skipped at Codex discovery and never
  // hashed there, so we don't trust them either.
  const stateEntries = [];
  for (const [evt, groups] of Object.entries(hooksFile.hooks)) {
    if (!EVENT_LABELS[evt] || !Array.isArray(groups)) continue;
    groups.forEach((g, i) => {
      if (!isPlainObject(g) || !Array.isArray(g.hooks)) return;
      g.hooks.forEach((hd, j) => {
        if (!isOurHandler(hd)) return;
        if (hd.async === true && evt !== "SessionEnd") return;
        stateEntries.push({
          key: `${hooksJsonPath}:${EVENT_LABELS[evt]}:${i}:${j}`,
          hash: trustedHash(evt, hd, isPlainObject(g) ? g.matcher : undefined),
        });
      });
    });
  }

  // --- config.toml: strip our old entries, append the fresh managed block ---
  // A stale manifest key may now name a FOREIGN hook's position (the user reordered
  // hooks.json since our last install). That [hooks.state] entry is the user's trust
  // decision, not ours — never strip a key whose position is currently occupied by a
  // handler that isn't ours.
  const namesForeignHandler = (key) => {
    if (!key.startsWith(hooksJsonPath + ":")) return false;
    const m = key.slice(hooksJsonPath.length + 1).match(/^([a-z_]+):(\d+):(\d+)$/);
    if (!m) return false;
    const evt = Object.keys(EVENT_LABELS).find((e) => EVENT_LABELS[e] === m[1]);
    const hd = evt && (hooksFile.hooks[evt] || [])[Number(m[2])]?.hooks?.[Number(m[3])];
    return hd != null && !isOurHandler(hd);
  };
  const prevKeys = (prevEntry.stateKeys || []).filter((k) => !namesForeignHandler(k));

  let toml = "";
  if (fs.existsSync(configTomlPath)) {
    backupOnce(configTomlPath);
    toml = fs.readFileSync(configTomlPath, "utf8");
  }
  const stripped = stripOurTrustEntries(toml, prevKeys.concat(stateEntries.map((e) => e.key)));
  if (stripped === null) {
    return fail([`ERROR: ${configTomlPath} has the status-bar block begin marker but no end marker ("${BLOCK_END}").`,
                 "Not touching it to avoid deleting config below the orphaned marker.",
                 "Restore the end marker (or delete the managed block), then re-run this installer."]);
  }
  toml = stripped.text;
  if (toml.length > 0 && !toml.endsWith("\n")) toml += "\n";
  const block = [BLOCK_BEGIN];
  for (const e of stateEntries) {
    block.push(`[hooks.state.${JSON.stringify(e.key)}]`);
    block.push(`trusted_hash = ${JSON.stringify(e.hash)}`);
    // A user who disabled one of our hooks (enabled = false) keeps that choice.
    if (stripped.disabled.has(e.key)) block.push("enabled = false");
  }
  block.push(BLOCK_END);
  writeAtomic(configTomlPath, toml + block.join("\n") + "\n");

  console.log("Installed status-bar hooks into", hooksJsonPath);
  console.log("Pre-trusted them in", configTomlPath, "(marked block)");
  return { hooksJsonPath, configTomlPath, createdHooksJson, stateKeys: stateEntries.map((e) => e.key) };
}

for (const codexHome of targets) {
  const entry = installInto(codexHome, installs[codexHome] || {});
  if (entry) installs[codexHome] = entry;
}

// --- manifest (lets uninstall/reinstall find exactly what we own, per codex home) ---

writeAtomic(manifestPath, JSON.stringify({ version: 2, node, installs }, null, 2) + "\n");

console.log("Scripts:", updateDest, "and", lifecycleDest);
const allBaks = Object.values(installs)
  .flatMap((e) => [e.hooksJsonPath, e.configTomlPath])
  .map((f) => f + ".bak-statusbar").filter((f) => fs.existsSync(f));
if (allBaks.length) console.log("Backups (first run only):", allBaks.join(" and "));
if (failures) process.exit(1);
