// The trusted_hash recipe and the managed block in config.toml.
//
// A hash that doesn't match what Codex computes means Codex silently skips the hook —
// no error, no status bar. The expectations here rebuild the hashed identity BY HAND
// (literal JSON strings, hashed with crypto) instead of calling into the installer, so
// a change to its normalization has to be deliberate: this file has to change too.

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  STALE_NODE, install, installWithStaleNode, failingShell, sandbox, hooksJsonPath, configTomlPath,
  readHooks, writeFile, shellQuote, expectedCommand, trustKeys, trustedHashOf,
} = require("./helpers");

const BLOCK_BEGIN = "# >>> codex-status-bar hooks trust (managed block, do not edit) >>>";
const BLOCK_END = "# <<< codex-status-bar hooks trust <<<";

const sha256 = (identityJson) => "sha256:" + crypto.createHash("sha256").update(Buffer.from(identityJson, "utf8")).digest("hex");
// Codex hashes compact JSON with recursively sorted keys: the handler is
// {async, command, timeout, type} and the top level {event_name, hooks} (+ matcher).
// Spelled out literally on purpose — this is the shape that Codex 0.145 accepts, and
// the installer's own normalization must keep producing exactly it.
const identity = (eventName, command, timeout, matcher) => {
  const handler = `{"async":false,"command":${JSON.stringify(command)},"timeout":${timeout},"type":"command"}`;
  return matcher === undefined
    ? `{"event_name":"${eventName}","hooks":[${handler}]}`
    : `{"event_name":"${eventName}","hooks":[${handler}],"matcher":${JSON.stringify(matcher)}}`;
};

test("hashes match the hand-computed identity for every event", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  const q = shellQuote(STALE_NODE);

  // [event, label, script, arg, timeout] — 600 is Codex's default, SessionEnd is clamped
  // into 1..3 and we ask for 3.
  const cases = [
    ["SessionStart", "session_start", "lifecycle.js", "start", 600],
    ["SessionEnd", "session_end", "lifecycle.js", "end", 3],
    ["UserPromptSubmit", "user_prompt_submit", "update.js", "prompt", 600],
    ["PreToolUse", "pre_tool_use", "update.js", "pre", 600],
    ["PostToolUse", "post_tool_use", "update.js", "post", 600],
    ["PermissionRequest", "permission_request", "update.js", "permreq", 600],
    ["Stop", "stop", "update.js", "stop", 600],
  ];
  for (const [, label, script, arg, timeout] of cases) {
    const key = `${hooksJsonPath(home)}:${label}:0:0`;
    const command = expectedCommand(home, script, arg, q);
    assert.equal(trustedHashOf(toml, key), sha256(identity(label, command, timeout)), label);
  }
  assert.equal(trustKeys(toml).length, 7);
});

test("the group matcher is hashed in — except where Codex ignores it", (t) => {
  const home = sandbox(t);
  // Mixed groups (ours + a foreign handler) are kept as-is, so they are the way to get
  // a matcher onto one of our handlers. Stop and UserPromptSubmit ignore matchers.
  const preCommand = expectedCommand(home, "update.js", "pre", shellQuote(STALE_NODE));
  const stopCommand = expectedCommand(home, "update.js", "stop", shellQuote(STALE_NODE));
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }, { type: "command", command: preCommand }] }],
      Stop: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }, { type: "command", command: stopCommand }] }],
    },
  }, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);

  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  assert.equal(trustedHashOf(toml, `${hooksJsonPath(home)}:pre_tool_use:0:1`),
    sha256(identity("pre_tool_use", preCommand, 600, "Bash")));
  assert.equal(trustedHashOf(toml, `${hooksJsonPath(home)}:stop:0:1`),
    sha256(identity("stop", stopCommand, 600)));
});

test("trust keys follow our handlers to their real position", (t) => {
  const home = sandbox(t);
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo first" }] }] },
  }, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);

  const keys = trustKeys(fs.readFileSync(configTomlPath(home), "utf8"));
  assert.ok(keys.includes(`${hooksJsonPath(home)}:pre_tool_use:1:0`), keys.join("\n"));
  assert.ok(!keys.includes(`${hooksJsonPath(home)}:pre_tool_use:0:0`), "must not claim the user's group");
});

test("foreign config, foreign trust entries and `notify` survive", (t) => {
  const home = sandbox(t);
  const foreign = [
    'model = "gpt-5.4-codex"',
    'notify = ["/usr/bin/say", "done"]',
    "",
    '[hooks.state."/somewhere/else/hooks.json:pre_tool_use:0:0"]',
    'trusted_hash = "sha256:deadbeef"',
    "",
  ].join("\n");
  writeFile(configTomlPath(home), foreign);
  assert.equal(installWithStaleNode(home).status, 0);

  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  assert.ok(toml.includes('model = "gpt-5.4-codex"'));
  assert.ok(toml.includes('notify = ["/usr/bin/say", "done"]'), "notify belongs to Codex Computer Use — never touch it");
  assert.equal(trustedHashOf(toml, "/somewhere/else/hooks.json:pre_tool_use:0:0"), "sha256:deadbeef");
  assert.equal(toml.split(BLOCK_BEGIN).length - 1, 1);
  assert.equal(toml.split(BLOCK_END).length - 1, 1);

  // Re-installing must not stack a second block or duplicate the foreign entry.
  assert.equal(installWithStaleNode(home).status, 0);
  const again = fs.readFileSync(configTomlPath(home), "utf8");
  assert.equal(again.split(BLOCK_BEGIN).length - 1, 1);
  assert.equal(again.split('[hooks.state."/somewhere/else/hooks.json:pre_tool_use:0:0"]').length - 1, 1);
  assert.equal(again, toml);
});

test("a user's `enabled = false` opt-out is preserved across installs", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const key = `${hooksJsonPath(home)}:stop:0:0`;

  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  const patched = toml.replace(`[hooks.state.${JSON.stringify(key)}]\n`, `[hooks.state.${JSON.stringify(key)}]\nenabled = false\n`);
  assert.notEqual(patched, toml);
  fs.writeFileSync(configTomlPath(home), patched);

  assert.equal(installWithStaleNode(home).status, 0);
  const after = fs.readFileSync(configTomlPath(home), "utf8");
  const header = `[hooks.state.${JSON.stringify(key)}]`;
  const section = after.slice(after.indexOf(header) + header.length).split("[hooks.state.")[0];
  assert.match(section, /enabled = false/);
  // …and only for that hook.
  assert.equal(after.split("enabled = false").length - 1, 1);
});

test("an orphaned block marker aborts instead of eating the config below it", (t) => {
  const home = sandbox(t);
  const original = [BLOCK_BEGIN, '[hooks.state."x:pre_tool_use:0:0"]', 'trusted_hash = "sha256:abc"', "", 'model = "gpt-5.4-codex"', ""].join("\n");
  writeFile(configTomlPath(home), original);
  const hooksBefore = fs.existsSync(hooksJsonPath(home))
    ? fs.readFileSync(hooksJsonPath(home), "utf8") : null;

  const res = installWithStaleNode(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no end marker/);
  assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), original);
  assert.equal(fs.existsSync(hooksJsonPath(home)), hooksBefore !== null,
    "refusing the config must not install hooks without their trust entries");
});

test("an inline comment on a disabled hook preserves the opt-out", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const key = `${hooksJsonPath(home)}:stop:0:0`;
  const header = `[hooks.state.${JSON.stringify(key)}]`;
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  writeFile(configTomlPath(home), toml.replace(header, `${header}\nenabled = false # disabled by the user`));

  assert.equal(installWithStaleNode(home).status, 0);
  const section = fs.readFileSync(configTomlPath(home), "utf8")
    .split(header)[1].split("[hooks.state.")[0];
  assert.match(section, /enabled = false/);
});

test("a refused reinstall keeps existing hook commands and trust consistent", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const hooksBefore = fs.readFileSync(hooksJsonPath(home), "utf8");
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  const truncated = toml.slice(0, toml.lastIndexOf(BLOCK_END));
  writeFile(configTomlPath(home), truncated);

  assert.equal(installWithStaleNode(home, { execPath: "/tmp/new-node" }).status, 1);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), hooksBefore);
  assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), truncated);
});

for (const [name, content] of [
  ["nested", `${BLOCK_BEGIN}\n${BLOCK_BEGIN}\n${BLOCK_END}\n`],
  ["end without begin", `${BLOCK_END}\n`],
]) {
  test(`a ${name} trust block marker refuses installation`, (t) => {
    const home = sandbox(t);
    writeFile(configTomlPath(home), content);
    assert.equal(installWithStaleNode(home).status, 1);
    assert.equal(fs.existsSync(hooksJsonPath(home)), false);
    assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), content);
  });
}

test("a config.toml comment inside our section is kept without breaking the TOML", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const key = `${hooksJsonPath(home)}:stop:0:0`;
  // Simulate the Codex TUI's trust review writing our key OUTSIDE the managed block,
  // with a comment of the user's own above the value.
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  writeFile(configTomlPath(home), [
    'model = "gpt-5.4-codex"',
    `[hooks.state.${JSON.stringify(key)}]`,
    "# approved in the TUI",
    'trusted_hash = "sha256:stale"',
    'model_reasoning_effort = "high"',
    "",
  ].join("\n") + toml);

  assert.equal(installWithStaleNode(home).status, 0);
  const after = fs.readFileSync(configTomlPath(home), "utf8");
  assert.ok(!after.includes('trusted_hash = "sha256:stale"'), "the stale hash must be dropped");
  assert.ok(after.includes("# approved in the TUI"), "the user's comment stays");
  assert.ok(after.includes('model_reasoning_effort = "high"'), "a key we never write ends our section");
  // The comment must not be followed by a stray value that would land in the wrong table.
  const lines = after.split("\n");
  const at = lines.findIndex((l) => l.trim() === "# approved in the TUI");
  assert.match(lines[at + 1].trim(), /^(\[|model_reasoning_effort|$)/, lines.slice(at, at + 3).join(" | "));
});

test("a stale trust key that now points at a foreign hook is left alone", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);

  // The user prepends a group of their own to PreToolUse: our hook moves from 0 to 1,
  // and our old key 0:0 now names THEIR hook — whose trust is theirs, not ours to strip.
  const hooksFile = readHooks(home);
  hooksFile.hooks.PreToolUse.unshift({ hooks: [{ type: "command", command: "echo theirs" }] });
  fs.writeFileSync(hooksJsonPath(home), JSON.stringify(hooksFile, null, 2) + "\n");
  const staleKey = `${hooksJsonPath(home)}:pre_tool_use:0:0`;
  fs.appendFileSync(configTomlPath(home), `\n[hooks.state.${JSON.stringify(staleKey)}]\ntrusted_hash = "sha256:theirs"\n`);

  assert.equal(installWithStaleNode(home).status, 0);
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  assert.equal(trustedHashOf(toml, staleKey), "sha256:theirs");
  assert.ok(trustKeys(toml).includes(`${hooksJsonPath(home)}:pre_tool_use:1:0`), "our hook is trusted at its new index");
});

test("changing the node path rewrites every hash", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const before = fs.readFileSync(configTomlPath(home), "utf8");

  assert.equal(install(home, { hideStableNodes: true, shell: failingShell(home), execPath: "/tmp/other/bin/node" }).status, 0);
  const after = fs.readFileSync(configTomlPath(home), "utf8");
  assert.deepEqual(trustKeys(after), trustKeys(before), "keys are positional — they must not move");
  for (const key of trustKeys(after)) {
    assert.notEqual(trustedHashOf(after, key), trustedHashOf(before, key), key);
  }
  const key = `${hooksJsonPath(home)}:stop:0:0`;
  assert.equal(trustedHashOf(after, key),
    sha256(identity("stop", expectedCommand(home, "update.js", "stop", shellQuote("/tmp/other/bin/node")), 600)));
});
