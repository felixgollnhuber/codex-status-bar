// Execute the real runtime hooks with isolated files and no access to launch apps.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { sandbox, sbDir, readJson, writeFile } = require("./helpers");

const wrapper = `
  const fs = require("node:fs");
  const path = require("node:path");
  const cp = require("node:child_process");
  cp.execFileSync = () => {
    if (process.env.APP_RUNNING === "0") throw new Error("not running");
    return Buffer.from("");
  };
  cp.spawn = () => {
    fs.appendFileSync(path.join(process.env.HOME, "launches"), "open\\n");
    return { unref() {} };
  };
  require(process.argv[1]);
`;

function hook(home, script, event, payload, { running = true } = {}) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath,
    ["-e", wrapper, path.resolve(__dirname, "../hooks", script), event], {
      env: { HOME: home, APP_RUNNING: running ? "1" : "0" },
      input, encoding: "utf8", timeout: 4000,
    });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "", "a hook must never emit a Codex decision");
  assert.equal(result.stderr, "");
}

const statePath = (home, id = "session-1") => path.join(sbDir(home), "state.d", `${id}.json`);
const state = (home, id) => readJson(statePath(home, id));
const payload = (extra = {}) => ({ session_id: "session-1", cwd: "/tmp/project", ...extra });

test("runtime events advance a session from prompt through tool use to done", (t) => {
  const home = sandbox(t);
  hook(home, "update.js", "prompt", payload({ transcript_path: "/tmp/rollout.jsonl" }));
  const startedAt = state(home).startedAt;
  assert.equal(state(home).state, "thinking");
  assert.equal(state(home).pid, process.pid);
  assert.equal(state(home).started, true);

  hook(home, "update.js", "pre", payload({ tool_name: "Bash" }));
  assert.equal(state(home).state, "tool");
  assert.equal(state(home).label, "Running command");
  assert.equal(state(home).startedAt, startedAt);
  assert.equal(state(home).transcript, "/tmp/rollout.jsonl");
  hook(home, "update.js", "post", payload());
  assert.equal(state(home).state, "thinking");
  hook(home, "update.js", "stop", payload());
  assert.equal(state(home).state, "done");
  assert.equal(state(home).startedAt, 0);
});

test("another lane cannot clear pending approvals or user input", (t) => {
  const home = sandbox(t);
  hook(home, "update.js", "pre", payload({ tool_name: "request_user_input" }));
  assert.equal(state(home).label, "Awaiting your input");
  hook(home, "update.js", "permreq", payload({ agent_id: "child" }));
  hook(home, "update.js", "post", payload({ agent_id: "other" }));
  assert.equal(state(home).state, "permission");
  assert.deepEqual(state(home).lanes, ["", "child"]);
  hook(home, "update.js", "post", payload());
  assert.equal(state(home).state, "permission");
  assert.deepEqual(state(home).lanes, ["child"]);
  hook(home, "update.js", "post", payload({ agent_id: "child" }));
  assert.equal(state(home).state, "thinking");
  assert.deepEqual(state(home).lanes, []);
});

test("a quit marker suppresses recovery until a new session starts", (t) => {
  const home = sandbox(t);
  writeFile(path.join(sbDir(home), "quit-intent"), "quit");
  hook(home, "update.js", "prompt", payload(), { running: false });
  assert.equal(fs.existsSync(path.join(home, "launches")), false);
  hook(home, "lifecycle.js", "start", payload());
  assert.equal(fs.existsSync(path.join(sbDir(home), "quit-intent")), false);
  assert.equal(fs.readFileSync(path.join(home, "launches"), "utf8"), "open\n");
});

test("activity from a session predating installation relaunches the app", (t) => {
  const home = sandbox(t);
  hook(home, "update.js", "pre", payload({ tool_name: "apply_patch" }), { running: false });
  assert.equal(state(home).label, "Editing");
  assert.equal(fs.readFileSync(path.join(home, "launches"), "utf8"), "open\n");
});

test("compaction preserves live state and explicit quit intent", (t) => {
  const home = sandbox(t);
  hook(home, "update.js", "prompt", payload());
  const before = fs.readFileSync(statePath(home), "utf8");
  writeFile(path.join(sbDir(home), "quit-intent"), "quit");
  hook(home, "lifecycle.js", "start", payload({ source: "compact" }), { running: false });
  assert.equal(fs.readFileSync(statePath(home), "utf8"), before);
  assert.equal(fs.existsSync(path.join(sbDir(home), "quit-intent")), true);
  assert.equal(fs.existsSync(path.join(home, "launches")), false);
});

test("session startup preserves live peers and fresh in-flight files", (t) => {
  const home = sandbox(t);
  writeFile(statePath(home, "live"), JSON.stringify({ pid: process.pid }));
  writeFile(statePath(home, "dead"), JSON.stringify({ pid: 0 }));
  const freshTmp = path.join(sbDir(home), "state.d", "live.json.123.tmp");
  writeFile(freshTmp, "{}");
  hook(home, "lifecycle.js", "start", payload(), { running: false });
  assert.equal(fs.existsSync(statePath(home, "live")), true);
  assert.equal(fs.existsSync(statePath(home, "dead")), false);
  assert.equal(fs.existsSync(freshTmp), true);
  assert.equal(state(home).state, "idle");
  assert.equal(state(home).started, false);
  hook(home, "lifecycle.js", "end", payload());
  assert.equal(fs.existsSync(statePath(home)), false);
  assert.equal(fs.existsSync(statePath(home, "live")), true);
});

test("malformed input and missing session ids never create or remove session files", (t) => {
  const home = sandbox(t);
  writeFile(statePath(home, "unknown"), JSON.stringify({ state: "tool", pid: process.pid }));
  const before = fs.readFileSync(statePath(home, "unknown"), "utf8");
  for (const input of ["{ broken", "null", "[]", "{}", '{"session_id":""}',
    '{"session_id":12}', '{"session_id":"$$"}']) {
    hook(home, "update.js", "prompt", input, { running: false });
    hook(home, "lifecycle.js", "start", input, { running: false });
    hook(home, "lifecycle.js", "end", input);
    assert.equal(fs.readFileSync(statePath(home, "unknown"), "utf8"), before);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(statePath(home))), ["unknown.json"]);
  assert.equal(fs.existsSync(path.join(home, "launches")), false);
});
