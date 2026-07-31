// How the installer decides which node the hook commands run, and what that means for
// the manifest. This is the failure mode that killed the upstream project's hooks for
// Homebrew users: a version-specific node path baked into the commands.

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const {
  STALE_NODE, install, installWithStaleNode, resolvingShell, failingShell,
  sandbox, readHooks, readManifest, ourHandlers, shellQuote, expectedCommand,
} = require("./helpers");

test("a stable node path wins over the node running the installer", (t) => {
  const home = sandbox(t);
  // Stable candidates are NOT hidden here: on any machine that has one (a Homebrew,
  // MacPorts, Volta, asdf, mise or Nix node), it must be preferred over execPath.
  const res = install(home, { shell: failingShell(home) });
  assert.equal(res.status, 0, res.stderr);

  const commands = ourHandlers(readHooks(home), home).map((e) => e.handler.command);
  assert.ok(commands.length > 0);
  for (const c of commands) assert.ok(!c.includes(STALE_NODE), `execPath leaked into: ${c}`);

  const manifestNode = readManifest(home).node;
  assert.notEqual(manifestNode, STALE_NODE);
  assert.ok(path.isAbsolute(manifestNode));
  for (const c of commands) assert.ok(c.startsWith(`exec ${shellQuote(manifestNode)} `), c);
});

test("without a stable path, a login shell that resolves node yields a bare `node`", (t) => {
  const home = sandbox(t);
  const res = install(home, { hideStableNodes: true, shell: resolvingShell(home) });
  assert.equal(res.status, 0, res.stderr);

  const commands = ourHandlers(readHooks(home), home).map((e) => e.handler.command);
  for (const c of commands) assert.ok(c.startsWith("exec node "), c);

  // No fixed path in the command means no path for the app to watch for disappearance;
  // a `node` key here would make the app reinstall the hooks on every single launch.
  assert.equal("node" in readManifest(home), false);
});

test("with neither, it falls back to the installer's own node and records it", (t) => {
  const home = sandbox(t);
  const res = installWithStaleNode(home);
  assert.equal(res.status, 0, res.stderr);

  const commands = ourHandlers(readHooks(home), home).map((e) => e.handler.command);
  for (const c of commands) assert.ok(c.startsWith(`exec ${shellQuote(STALE_NODE)} `), c);
  // Recorded so the app notices the path went stale and reinstalls the hooks.
  assert.equal(readManifest(home).node, STALE_NODE);
});

test("a login shell that answers with something unusable is not trusted", (t) => {
  const home = sandbox(t);
  const { writeFile } = require("./helpers");
  const shell = path.join(home, "bin", "shell-junk");
  writeFile(shell, "#!/bin/sh\necho 'node is a shell function'\n");
  require("node:fs").chmodSync(shell, 0o755);

  const res = install(home, { hideStableNodes: true, shell });
  assert.equal(res.status, 0, res.stderr);
  // Not an absolute path -> must not become a bare `node`; falls through to execPath.
  const commands = ourHandlers(readHooks(home), home).map((e) => e.handler.command);
  for (const c of commands) assert.ok(c.startsWith(`exec ${shellQuote(STALE_NODE)} `), c);
});

test("commands never use shell syntax that fish rejects", (t) => {
  const home = sandbox(t);
  for (const opts of [{ shell: failingShell(home) },
                      { hideStableNodes: true, shell: resolvingShell(home) },
                      { hideStableNodes: true, shell: failingShell(home) }]) {
    assert.equal(install(home, opts).status, 0);
    for (const { handler } of ourHandlers(readHooks(home), home)) {
      const c = handler.command;
      // `VAR=value cmd` prefixes and ${VAR:+…} are hard syntax errors in fish, which
      // Codex uses as `$SHELL -lc` for whoever runs fish. Upstream's fix uses both.
      assert.ok(!/^\w+=/.test(c), `env-assignment prefix in: ${c}`);
      assert.ok(!c.includes("${"), `parameter expansion in: ${c}`);
      assert.ok(c.startsWith("exec "), c);
    }
  }
});

test("paths with quotes, dollars and backticks survive quoting", (t) => {
  const home = sandbox(t, { weird: true });
  const res = installWithStaleNode(home);
  assert.equal(res.status, 0, res.stderr);

  const handlers = ourHandlers(readHooks(home), home);
  assert.equal(handlers.length, 7);
  assert.deepEqual(
    handlers.map((e) => e.handler.command).sort(),
    [["lifecycle.js", "start"], ["lifecycle.js", "end"], ["update.js", "prompt"], ["update.js", "pre"],
     ["update.js", "post"], ["update.js", "permreq"], ["update.js", "stop"]]
      .map(([s, e]) => expectedCommand(home, s, e, shellQuote(STALE_NODE))).sort());
});

test("the quoted command actually runs under sh, zsh, bash and fish", (t) => {
  const home = sandbox(t, { weird: true });
  assert.equal(install(home, { shell: failingShell(home) }).status, 0);

  const { execFileSync } = require("node:child_process");
  const fs = require("node:fs");
  // `update.js post` with no session state is a no-op that must exit 0 silently — the
  // same contract the hooks rely on, so it doubles as a smoke test of the command.
  const command = ourHandlers(readHooks(home), home)
    .find((e) => e.handler.command.endsWith(" post")).handler.command;

  const shells = ["/bin/sh", "/bin/zsh", "/bin/bash", "/opt/homebrew/bin/fish", "/usr/local/bin/fish"]
    .filter((s) => fs.existsSync(s));
  assert.ok(shells.length >= 3, "expected at least sh, zsh and bash to exist");
  for (const shell of shells) {
    const out = execFileSync(shell, ["-lc", command], { encoding: "utf8", stdio: "pipe", env: { ...process.env, HOME: home } });
    assert.equal(out, "", `${shell} printed output (Codex would read it as a hook decision): ${out}`);
  }
});
