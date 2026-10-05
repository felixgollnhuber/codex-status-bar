// Uninstalling has to be surgical: everything of ours goes, everything of the user's
// stays — including trust entries whose position shifts once our groups are removed.

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  STALE_NODE, installWithStaleNode, uninstall, sandbox, hooksJsonPath, configTomlPath, sbDir,
  readHooks, readManifest, writeFile, shellQuote, expectedCommand, trustKeys, trustedHashOf,
} = require("./helpers");

const BLOCK_BEGIN = "# >>> codex-status-bar hooks trust (managed block, do not edit) >>>";

test("removes hooks.json entirely when we created it, plus the state dir", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(uninstall(home).status, 0);

  assert.equal(fs.existsSync(hooksJsonPath(home)), false);
  assert.equal(fs.existsSync(sbDir(home)), false);
  assert.ok(!fs.readFileSync(configTomlPath(home), "utf8").includes(BLOCK_BEGIN));
});

test("keeps a hooks.json that was not ours, minus our groups", (t) => {
  const home = sandbox(t);
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: "echo theirs" }] }],
      PreCompact: [{ hooks: [{ type: "command", command: "echo compact" }] }],
    },
  }, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(uninstall(home).status, 0);

  const hooksFile = readHooks(home);
  assert.deepEqual(Object.keys(hooksFile.hooks).sort(), ["PreCompact", "PreToolUse"]);
  assert.equal(hooksFile.hooks.PreToolUse.length, 1);
  assert.equal(hooksFile.hooks.PreToolUse[0].hooks[0].command, "echo theirs");
});

test("a mixed group loses only our handler", (t) => {
  const home = sandbox(t);
  const ourCommand = expectedCommand(home, "update.js", "pre", shellQuote(STALE_NODE));
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }, { type: "command", command: ourCommand }] }] },
  }, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(uninstall(home).status, 0);

  const groups = readHooks(home).hooks.PreToolUse;
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].hooks.map((h) => h.command), ["echo mine"]);
  assert.equal(groups[0].matcher, "Bash");
});

test("surviving foreign trust entries are re-keyed to their new position", (t) => {
  const home = sandbox(t);
  // Our PreToolUse group lands at index 1, behind the user's. After removal the user's
  // hook is still at 0, but their SECOND group moves 2 -> 1.
  writeFile(hooksJsonPath(home), JSON.stringify({
    hooks: {
      PreToolUse: [
        { hooks: [{ type: "command", command: "echo a" }] },
        { hooks: [{ type: "command", command: "echo b" }] },
      ],
    },
  }, null, 2));
  assert.equal(installWithStaleNode(home).status, 0);

  // The user trusts both of their hooks; ours sits between them at index 2.
  const hj = hooksJsonPath(home);
  const groups = readHooks(home).hooks.PreToolUse;
  assert.equal(groups[2].hooks[0].command, expectedCommand(home, "update.js", "pre", shellQuote(STALE_NODE)));
  fs.appendFileSync(configTomlPath(home), [
    "", `[hooks.state."${hj}:pre_tool_use:0:0"]`, 'trusted_hash = "sha256:aaa"',
    "", `[hooks.state."${hj}:pre_tool_use:1:0"]`, 'trusted_hash = "sha256:bbb"', "",
  ].join("\n"));

  assert.equal(uninstall(home).status, 0);
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  assert.equal(trustedHashOf(toml, `${hj}:pre_tool_use:0:0`), "sha256:aaa");
  assert.equal(trustedHashOf(toml, `${hj}:pre_tool_use:1:0`), "sha256:bbb");
  assert.equal(trustKeys(toml).length, 2, "our own keys must be gone");
});

test("foreign config and `notify` survive uninstalling", (t) => {
  const home = sandbox(t);
  writeFile(configTomlPath(home), 'model = "gpt-5.4-codex"\nnotify = ["/usr/bin/say"]\n');
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(uninstall(home).status, 0);

  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  assert.ok(toml.includes('model = "gpt-5.4-codex"'));
  assert.ok(toml.includes('notify = ["/usr/bin/say"]'));
  assert.equal(trustKeys(toml).length, 0);
});

test("an orphaned block marker aborts the uninstall too", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  const truncated = toml.slice(0, toml.lastIndexOf("# <<<"));
  fs.writeFileSync(configTomlPath(home), truncated);
  const hooksBefore = fs.readFileSync(hooksJsonPath(home), "utf8");

  const res = uninstall(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no end marker/);
  assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), truncated);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), hooksBefore,
    "refusing the config must leave its corresponding hooks intact");
  assert.ok(fs.existsSync(sbDir(home)), "the scripts must stay too");
});

test("a broken later home leaves earlier installations intact", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const custom = path.join(home, "custom-codex");
  assert.equal(installWithStaleNode(home, { codexHome: custom }).status, 0);
  const hooksBefore = fs.readFileSync(hooksJsonPath(home), "utf8");
  const tomlBefore = fs.readFileSync(configTomlPath(home), "utf8");
  writeFile(path.join(custom, "hooks.json"), "{ not json");

  assert.equal(uninstall(home).status, 1);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), hooksBefore);
  assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), tomlBefore);
  assert.ok(fs.existsSync(sbDir(home)));
});

test("marker text inside a comment cannot close an incomplete trust block", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const hooksBefore = fs.readFileSync(hooksJsonPath(home), "utf8");
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  const end = "# <<< codex-status-bar hooks trust <<<";
  const truncated = toml.slice(0, toml.lastIndexOf(end)) + `# example footer: ${end}\n`;
  writeFile(configTomlPath(home), truncated);

  const res = uninstall(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no end marker/);
  assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), hooksBefore);
  assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), truncated);
});

for (const [name, content] of [
  ["nested", `${BLOCK_BEGIN}\n${BLOCK_BEGIN}\n# <<< codex-status-bar hooks trust <<<\n`],
  ["end without begin", "# <<< codex-status-bar hooks trust <<<\n"],
]) {
  test(`a ${name} trust block marker refuses uninstall`, (t) => {
    const home = sandbox(t);
    assert.equal(installWithStaleNode(home).status, 0);
    const hooksBefore = fs.readFileSync(hooksJsonPath(home), "utf8");
    writeFile(configTomlPath(home), content);
    assert.equal(uninstall(home).status, 1);
    assert.equal(fs.readFileSync(hooksJsonPath(home), "utf8"), hooksBefore);
    assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), content);
  });
}

test("a broken hooks.json aborts before trust entries are dropped", (t) => {
  const home = sandbox(t);
  assert.equal(installWithStaleNode(home).status, 0);
  const toml = fs.readFileSync(configTomlPath(home), "utf8");
  fs.writeFileSync(hooksJsonPath(home), "{ not json");

  const res = uninstall(home);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Aborting/);
  assert.equal(fs.readFileSync(configTomlPath(home), "utf8"), toml, "trust must stay consistent with the hooks");
  assert.ok(fs.existsSync(sbDir(home)), "the scripts must stay too");
});

test("uninstalling a home with a quote in its path still finds our hooks", (t) => {
  const home = sandbox(t, { weird: true });
  assert.equal(installWithStaleNode(home).status, 0);
  assert.equal(uninstall(home).status, 0);
  assert.equal(fs.existsSync(hooksJsonPath(home)), false);
  assert.equal(fs.existsSync(sbDir(home)), false);
});

test("a custom CODEX_HOME is created if missing, refreshed later, and fully uninstalled", (t) => {
  const home = sandbox(t);
  const custom = path.join(home, "custom-codex"); // deliberately does not exist yet
  const res = installWithStaleNode(home, { codexHome: custom });
  assert.equal(res.status, 0, res.stderr);

  assert.equal(fs.existsSync(path.join(custom, "hooks.json")), true);
  assert.equal(fs.existsSync(hooksJsonPath(home)), false, "must not seed ~/.codex behind the user's back");
  assert.deepEqual(Object.keys(readManifest(home).installs), [custom]);
  // The app re-runs the installer without CODEX_HOME set: the recorded home must be
  // refreshed, and ~/.codex still left alone.
  assert.equal(installWithStaleNode(home).status, 0);
  assert.deepEqual(Object.keys(readManifest(home).installs), [custom]);
  assert.equal(fs.existsSync(hooksJsonPath(home)), false);

  assert.equal(uninstall(home).status, 0);
  assert.equal(fs.existsSync(path.join(custom, "hooks.json")), false);
  assert.ok(!fs.readFileSync(path.join(custom, "config.toml"), "utf8").includes(BLOCK_BEGIN));
});

test("a recorded home that the user deleted is dropped, not resurrected", (t) => {
  const home = sandbox(t);
  const custom = path.join(home, "custom-codex");
  assert.equal(installWithStaleNode(home, { codexHome: custom }).status, 0);
  fs.rmSync(custom, { recursive: true, force: true });

  // Env-less re-run (how the app invokes the installer): the gone home must not come back.
  const res = installWithStaleNode(home);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /no longer exists/);
  assert.equal(fs.existsSync(custom), false);
  assert.deepEqual(Object.keys(readManifest(home).installs), []);

  // Having forgotten it, the next run installs into the default home again.
  assert.equal(installWithStaleNode(home).status, 0);
  assert.deepEqual(Object.keys(readManifest(home).installs), [path.join(home, ".codex")]);
  assert.equal(fs.existsSync(hooksJsonPath(home)), true);
});
