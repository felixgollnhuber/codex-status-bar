// Merging into an existing hooks.json. The invariant that matters: trust keys in
// config.toml address hooks by POSITION (`<file>:<event>:<group>:<handler>`), so any
// index shift silently invalidates somebody's trust — ours or the user's.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const {
  STALE_NODE, install, installWithStaleNode, failingShell, sandbox,
  hooksJsonPath, readHooks, writeFile, shellQuote, expectedCommand, ourHandlers,
} = require("./helpers");

const EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop"];

test("a fresh install registers all seven events", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);

  const hooksFile = readHooks(home);
  assert.deepEqual(Object.keys(hooksFile.hooks).sort(), [...EVENTS].sort());
  for (const evt of EVENTS) {
    assert.equal(hooksFile.hooks[evt].length, 1);
    assert.equal(hooksFile.hooks[evt][0].hooks.length, 1);
    assert.equal(hooksFile.hooks[evt][0].hooks[0].type, "command");
  }
  // SessionEnd is the one event Codex clamps to 1..3s; we ask for the full 3.
  assert.equal(hooksFile.hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.equal(hooksFile.hooks.SessionStart[0].hooks[0].timeout, undefined);
  assert.equal(Object.keys(hooksFile).sort().join(), "description,hooks"); // Codex rejects extra top-level keys
});

test("re-installing is idempotent", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const first = fs.readFileSync(hooksJsonPath(home), "utf8");
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), first);
});

test("foreign groups keep their index; ours is replaced in place", (t) => {
  const home = sandbox(t);
  const before = {
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo first" }] },
        { hooks: [{ type: "command", command: "echo second" }] },
      ],
    },
  };
  writeFile(hooksJsonPath(home), JSON.stringify(before, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);

  let groups = readHooks(home).hooks.PreToolUse;
  assert.equal(groups.length, 3);
  assert.equal(groups[0].hooks[0].command, "echo first");
  assert.equal(groups[0].matcher, "Bash");
  assert.equal(groups[1].hooks[0].command, "echo second");
  assert.equal(groups[2].hooks[0].command, expectedCommand(home, "update.js", "pre", shellQuote(STALE_NODE)));

  // A second install with a different node must overwrite index 2, not append at 3.
  assert.equal(install(home, { hideStableNodes: true, shell: failingShell(home), execPath: "/tmp/other/bin/node" }).status, 0);
  groups = readHooks(home).hooks.PreToolUse;
  assert.equal(groups.length, 3);
  assert.equal(groups[0].hooks[0].command, "echo first");
  assert.equal(groups[2].hooks[0].command, expectedCommand(home, "update.js", "pre", shellQuote("/tmp/other/bin/node")));
});

test("a hand-edited group that mixes our hook with the user's is left alone", (t) => {
  const home = sandbox(t);
  const ourCommand = expectedCommand(home, "update.js", "pre", shellQuote(STALE_NODE));
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }, { type: "command", command: ourCommand }] }],
    },
  }, null, 2));
  const res = installWithStaleNode(home);
  assert.equal(res.status, 0, res.stderr);

  const groups = readHooks(home).hooks.PreToolUse;
  assert.equal(groups.length, 1, "must not append a second copy next to the mixed group");
  assert.deepEqual(groups[0].hooks.map((h) => h.command), ["echo mine", ourCommand]);
  assert.match(res.stdout, /hand-edited group/);
});

test("hooks for other events are never touched", (t) => {
  const home = sandbox(t);
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: { PreCompact: [{ hooks: [{ type: "command", command: "echo compact", timeout: 42 }] }] },
  }, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);
  assert.deepEqual(readHooks(home).hooks.PreCompact, [{ hooks: [{ type: "command", command: "echo compact", timeout: 42 }] }]);
});

test("invalid JSON is refused, not overwritten", (t) => {
  const home = sandbox(t);
  writeFile(hooksJsonPath(home), "{ not json");
  const res = installWithStaleNode(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not valid JSON/);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), "{ not json");
});

test("a top-level key Codex would reject is refused, not overwritten", (t) => {
  const home = sandbox(t);
  const original = JSON.stringify({ version: 1, hooks: {} }, null, 2);
  writeFile(hooksJsonPath(home), original);
  const res = installWithStaleNode(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /top-level key/);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), original);
});

test("a malformed matcher group is refused, not overwritten", (t) => {
  const home = sandbox(t);
  const original = JSON.stringify({ hooks: { PreToolUse: [{ hooks: "nope" }] } }, null, 2);
  writeFile(hooksJsonPath(home), original);
  const res = installWithStaleNode(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /malformed matcher group/);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), original);
});

test("an existing hooks.json is backed up once, and the backup is not rewritten", (t) => {
  const home = sandbox(t);
  const original = JSON.stringify({ hooks: { PreCompact: [{ hooks: [{ type: "command", command: "echo one" }] }] } }, null, 2);
  writeFile(hooksJsonPath(home), original);
  assert.equal(installWithStaleNode(home).status, 0);
  const backup = hooksJsonPath(home) + ".bak-statusbar";
  assert.equal(fs.readFileSync(backup, "utf8"), original);

  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(fs.readFileSync(backup, "utf8"), original, "the backup must still hold the pre-install state");
});

test("our own handlers are found again even in a home path containing a quote", (t) => {
  const home = sandbox(t, { weird: true });
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(installWithStaleNode(home).status, 0);
  // If isOurHandler failed to match the quoted command, the second run would append a
  // duplicate group instead of replacing ours.
  for (const evt of EVENTS) assert.equal(readHooks(home).hooks[evt].length, 1, evt);
  assert.equal(ourHandlers(readHooks(home), home).length, 7);
});
