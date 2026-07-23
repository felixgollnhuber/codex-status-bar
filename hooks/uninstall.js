#!/usr/bin/env node
// Removes the status-bar hooks from every Codex home the installer touched (per the
// manifest), drops our trusted_hash entries from config.toml, re-keys surviving
// foreign trust entries whose group indices shift, clears the app's preferences, and
// deletes ~/.codex/statusbar. Never touches `notify` or hooks we didn't install.

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const home = os.homedir();
const envCodexHome = process.env.CODEX_HOME || path.join(home, ".codex");
const sbDir = path.join(home, ".codex", "statusbar");
const MARKER = sbDir;
const manifestPath = path.join(sbDir, "install-manifest.json");

const BLOCK_BEGIN = "# >>> codex-status-bar hooks trust (managed block, do not edit) >>>";
const BLOCK_END = "# <<< codex-status-bar hooks trust <<<";

const LABELS = {
  PreToolUse: "pre_tool_use", PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use", PreCompact: "pre_compact", PostCompact: "post_compact",
  SessionStart: "session_start", SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit", SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop", Stop: "stop",
};

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isOurHandler = (h) => isPlainObject(h) && typeof h.command === "string" && h.command.includes(MARKER);
const hasOurHandler = (g) => isPlainObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHandler);
const isOurs = (g) => isPlainObject(g) && Array.isArray(g.hooks) && g.hooks.length > 0 && g.hooks.every(isOurHandler);

function writeAtomic(file, text) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// --- targets: every codex home the manifest records, plus the current env one ---

let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
const installs = isPlainObject(manifest.installs) ? { ...manifest.installs } : {};
if (!isPlainObject(manifest.installs) && typeof manifest.hooksJsonPath === "string") {
  installs[path.dirname(manifest.hooksJsonPath)] = {
    createdHooksJson: manifest.createdHooksJson === true,
    stateKeys: manifest.stateKeys || [],
  };
}
if (!installs[envCodexHome]) installs[envCodexHome] = { createdHooksJson: false, stateKeys: [] };

try { cp.execFileSync("pkill", ["-x", "CodexStatusBar"], { stdio: "ignore" }); } catch {}

for (const [codexHome, entry] of Object.entries(installs)) {
  const hooksJsonPath = path.join(codexHome, "hooks.json");
  const configTomlPath = path.join(codexHome, "config.toml");

  // --- hooks.json: strip our groups/handlers, recording the index shifts and the
  // trust keys that are actually ours (derived from the scan, not from a possibly
  // stale manifest — a stale key can name a foreign hook's position). ---
  const groupShifts = {};   // event label -> removed group indices (original numbering)
  const handlerShifts = {}; // `${label}:${groupIndex}` -> removed handler indices
  let scanOwnKeys = null;   // null = no hooks.json to scan; fall back to manifest keys
  if (fs.existsSync(hooksJsonPath)) {
    try {
      const hooksFile = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
      if (!isPlainObject(hooksFile) || (hooksFile.hooks != null && !isPlainObject(hooksFile.hooks))) throw new Error("unexpected shape");
      scanOwnKeys = new Set();
      for (const evt of Object.keys(hooksFile.hooks || {})) {
        const label = LABELS[evt];
        const groups = hooksFile.hooks[evt];
        if (!Array.isArray(groups)) continue;
        const kept = [];
        groups.forEach((g, i) => {
          if (isOurs(g)) {
            if (label) {
              (groupShifts[label] = groupShifts[label] || []).push(i);
              g.hooks.forEach((_, j) => scanOwnKeys.add(`${hooksJsonPath}:${label}:${i}:${j}`));
            }
            return;
          }
          if (hasOurHandler(g)) {
            // Mixed group: remove only our handlers, keep the user's.
            const keptHooks = [];
            g.hooks.forEach((h, j) => {
              if (isOurHandler(h)) {
                if (label) {
                  (handlerShifts[`${label}:${i}`] = handlerShifts[`${label}:${i}`] || []).push(j);
                  scanOwnKeys.add(`${hooksJsonPath}:${label}:${i}:${j}`);
                }
              } else keptHooks.push(h);
            });
            kept.push({ ...g, hooks: keptHooks });
            return;
          }
          kept.push(g);
        });
        if (kept.length === 0) delete hooksFile.hooks[evt];
        else hooksFile.hooks[evt] = kept;
      }
      const empty = Object.keys(hooksFile.hooks || {}).length === 0;
      if (empty && entry.createdHooksJson) {
        fs.rmSync(hooksJsonPath, { force: true });
        console.log("Removed", hooksJsonPath, "(we created it and it is now empty)");
      } else {
        writeAtomic(hooksJsonPath, JSON.stringify(hooksFile, null, 2) + "\n");
        console.log("Removed status-bar hooks from", hooksJsonPath);
      }
    } catch (e) {
      console.error("Could not update", hooksJsonPath, "-", e.message);
      console.error("Aborting: leaving trust entries and scripts in place so the hooks stay consistent.");
      console.error("Fix (or delete) " + hooksJsonPath + " and re-run this uninstaller.");
      process.exit(1);
    }
  }

  // --- config.toml: drop the managed block + our sections; re-key shifted survivors ---
  if (fs.existsSync(configTomlPath)) {
    const raw = fs.readFileSync(configTomlPath, "utf8");
    if (raw.includes(BLOCK_BEGIN) && !raw.includes(BLOCK_END)) {
      console.error(`ERROR: ${configTomlPath} has the status-bar block begin marker but no end marker ("${BLOCK_END}").`);
      console.error("Aborting to avoid deleting config below the orphaned marker. Restore the end marker, then re-run.");
      process.exit(1);
    }
    const ownKeys = scanOwnKeys !== null ? scanOwnKeys : new Set(entry.stateKeys || []);
    const ownHeaders = new Set([...ownKeys].map((k) => `[hooks.state.${JSON.stringify(k)}]`));
    const headerRe = /^\[hooks\.state\."((?:[^"\\]|\\.)*)"\]$/;
    // Returns the re-keyed key, or null when the entry points AT one of our removed
    // positions (a stale/desynced entry for a hook that no longer exists — keeping it
    // would collide with a re-keyed survivor and corrupt the TOML).
    const remapKey = (key) => {
      const parts = key.split(":"); // <path>:<label>:<g>:<j> — our paths contain no ":"
      if (parts.length < 4) return key;
      const j = parseInt(parts.pop(), 10), g = parseInt(parts.pop(), 10), label = parts.pop();
      const p = parts.join(":");
      if (p !== hooksJsonPath || !Number.isInteger(g) || !Number.isInteger(j)) return key;
      const removedGroups = groupShifts[label] || [];
      if (removedGroups.includes(g)) return null;
      const removedHandlers = handlerShifts[`${label}:${g}`] || [];
      if (removedHandlers.includes(j)) return null;
      const g2 = g - removedGroups.filter((r) => r < g).length;
      const j2 = j - removedHandlers.filter((r) => r < j).length;
      return `${p}:${label}:${g2}:${j2}`;
    };
    const out = [];
    let inBlock = false, skipSection = false;
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === BLOCK_BEGIN) { inBlock = true; continue; }
      if (trimmed === BLOCK_END) { inBlock = false; continue; }
      if (inBlock) continue;
      if (trimmed.startsWith("[")) {
        skipSection = ownHeaders.has(trimmed);
        if (!skipSection) {
          const m = trimmed.match(headerRe);
          if (m) {
            try {
              const key = JSON.parse(`"${m[1]}"`);
              const key2 = remapKey(key);
              if (key2 === null) { skipSection = true; continue; }
              if (key2 !== key) { out.push(`[hooks.state.${JSON.stringify(key2)}]`); continue; }
            } catch {}
          }
        }
      }
      if (!skipSection) out.push(line);
    }
    writeAtomic(configTomlPath, out.join("\n"));
    console.log("Removed status-bar trust entries from", configTomlPath);
  }
}

// --- app preferences: without this, reinstalling the SAME version would skip the
// hook self-install (installedVersion guard). `defaults delete` goes through
// cfprefsd, so the cached domain can't resurrect. ---
try { cp.execFileSync("defaults", ["delete", "com.local.codexstatusbar"], { stdio: "ignore" }); } catch {}

// --- state dir (also removes the copied scripts and this manifest) ---
try { fs.rmSync(sbDir, { recursive: true, force: true }); } catch {}
console.log("Removed", sbDir, "and the app preferences");
console.log("Done. The app itself can be dragged to the Trash from /Applications.");
