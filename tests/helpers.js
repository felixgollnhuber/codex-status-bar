// Shared harness for the installer/uninstaller tests.
//
// Everything runs black box: the real scripts are executed against a throwaway HOME and
// the resulting hooks.json / config.toml / manifest are inspected. Only three things are
// stubbed, all of them reaching outside the sandbox:
//   - `pkill` / `defaults` (the uninstaller would kill the real app and delete the real
//     preferences of whoever runs the tests),
//   - `process.execPath` (so the "no stable node anywhere" fallback is reproducible),
//   - `fs.accessSync` for */node (hides this machine's real node installs, which would
//     otherwise decide which resolution branch we exercise).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const installerPath = path.resolve(__dirname, "../hooks/install.js");
const uninstallerPath = path.resolve(__dirname, "../hooks/uninstall.js");

// A node path of the shape a version manager hands out: stable today, gone after the
// next upgrade. Used as the mocked process.execPath.
const STALE_NODE = "/opt/homebrew/Cellar/node/26.5.0/bin/node";

const WRAPPER = `
  const path = require("node:path");
  const cp = require("node:child_process");
  const realExecFileSync = cp.execFileSync;
  cp.execFileSync = (file, args, opts) =>
    (file === "pkill" || file === "defaults") ? Buffer.from("") : realExecFileSync(file, args, opts);
  if (process.env.MOCK_EXEC_PATH) {
    Object.defineProperty(process, "execPath", { value: process.env.MOCK_EXEC_PATH });
  }
  if (process.env.HIDE_STABLE_NODES) {
    const fs = require("node:fs");
    const realAccessSync = fs.accessSync;
    fs.accessSync = (p, mode) => {
      if (path.basename(String(p)) === "node") { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return realAccessSync(p, mode);
    };
  }
  require(process.env.SCRIPT_PATH);
`;

// Runs a script with HOME (and optionally CODEX_HOME/SHELL) redirected into the sandbox.
// Returns { status, stdout, stderr } instead of throwing, so failure paths are testable.
function run(scriptPath, home, opts = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    SCRIPT_PATH: scriptPath,
    MOCK_EXEC_PATH: opts.execPath === undefined ? STALE_NODE : opts.execPath,
  };
  if (opts.hideStableNodes) env.HIDE_STABLE_NODES = "1";
  if (opts.codexHome) env.CODEX_HOME = opts.codexHome;
  if (opts.shell) env.SHELL = opts.shell;
  try {
    const stdout = execFileSync(process.execPath, ["-e", WRAPPER], { env, encoding: "utf8", stdio: "pipe" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    return { status: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
  }
}

const install = (home, opts) => run(installerPath, home, opts);
const uninstall = (home, opts) => run(uninstallerPath, home, opts);

// Installs with every real node hidden and a shell that cannot resolve node either, so
// the command lands on the mocked execPath — the one fully deterministic combination.
const installWithStaleNode = (home, opts = {}) =>
  install(home, { hideStableNodes: true, shell: failingShell(home), ...opts });

// A fake login shell. `resolves` prints a working node path for `command -v node`
// (the installer only ever asks it that); otherwise it exits non-zero.
function fakeShell(dir, name, resolves) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, resolves ? `#!/bin/sh\necho ${JSON.stringify(process.execPath)}\n` : "#!/bin/sh\nexit 1\n");
  fs.chmodSync(p, 0o755);
  return p;
}
const resolvingShell = (home) => fakeShell(path.join(home, "bin"), "shell-ok", true);
const failingShell = (home) => fakeShell(path.join(home, "bin"), "shell-bad", false);

function sandbox(t, { weird = false } = {}) {
  // A home with a quote, a dollar and a backtick in it: anything that survives this
  // survives real-world paths. Off by default to keep failure output readable.
  const prefix = weird ? `codex $\`"' status bar test-` : "codex-status-bar-test-";
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

const codexHome = (home) => path.join(home, ".codex");
const hooksJsonPath = (home) => path.join(codexHome(home), "hooks.json");
const configTomlPath = (home) => path.join(codexHome(home), "config.toml");
const sbDir = (home) => path.join(codexHome(home), "statusbar");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readHooks = (home, at) => readJson(at ? path.join(at, "hooks.json") : hooksJsonPath(home));
const readManifest = (home) => readJson(path.join(sbDir(home), "install-manifest.json"));
const readToml = (home, at) => fs.readFileSync(at ? path.join(at, "config.toml") : configTomlPath(home), "utf8");

const writeFile = (p, text) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const shellQuote = (v) => `'${v.replace(/'/g, `'\\''`)}'`;

// The command the installer is expected to write. `nodeWord` is either a quoted absolute
// path or the bare word `node`.
const expectedCommand = (home, script, evt, nodeWord) =>
  `exec ${nodeWord} ${shellQuote(path.join(sbDir(home), script))} ${evt}`;

// Every handler in the file, tagged with its event and position.
function allHandlers(hooksFile) {
  const out = [];
  for (const [evt, groups] of Object.entries(hooksFile.hooks || {})) {
    (groups || []).forEach((g, i) => (g.hooks || []).forEach((h, j) => out.push({ evt, group: i, index: j, handler: h })));
  }
  return out;
}
const ourHandlers = (hooksFile, home) =>
  allHandlers(hooksFile).filter((e) => (e.handler.command || "").includes("statusbar"));

// TOML section headers of the managed trust block, in file order.
const trustKeys = (toml) =>
  [...toml.matchAll(/^\[hooks\.state\."((?:[^"\\]|\\.)*)"\]$/gm)].map((m) => JSON.parse(`"${m[1]}"`));

const trustedHashOf = (toml, key) => {
  const lines = toml.split("\n");
  const i = lines.findIndex((l) => l.trim() === `[hooks.state.${JSON.stringify(key)}]`);
  if (i === -1) return null;
  for (const l of lines.slice(i + 1)) {
    if (l.trim().startsWith("[")) return null;
    const m = l.trim().match(/^trusted_hash\s*=\s*"(.+)"$/);
    if (m) return m[1];
  }
  return null;
};

module.exports = {
  STALE_NODE, install, uninstall, installWithStaleNode, resolvingShell, failingShell,
  sandbox, codexHome, hooksJsonPath, configTomlPath, sbDir,
  readHooks, readManifest, readToml, readJson, writeFile,
  shellQuote, expectedCommand, allHandlers, ourHandlers, trustKeys, trustedHashOf,
};
