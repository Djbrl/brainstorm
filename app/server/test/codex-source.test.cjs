// Reading Codex's session logs (listener/codex.source.ts): hand-made lines in the shapes Codex writes, made-up paths.
require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { makeListener, dist, line, jsonl, ts } = require("./helpers.cjs");

const ROOT = "/work/demo-repo";
let n = 0;
const uuid = () => `01a0c000-0000-7000-8000-${String(++n).padStart(12, "0")}`;

/** A Codex thread's lines: `L.meta()` first, then items and model records, each with its time and ordinal. */
function codex(id, { cwd = ROOT, version = "0.155.0-alpha.1", source = "vscode", extra = {} } = {}) {
  let ord = 0;
  let i = 0;
  const L = (type, payload) => ({ timestamp: ts(i++), ordinal: ord++, type, payload });
  const turn = { id: "turn-1" };
  return {
    meta: () => L("session_meta", { id, session_id: id, timestamp: ts(0), cwd, originator: "Codex Desktop", cli_version: version, source, model_provider: "openai", base_instructions: { text: "You are Codex. SECRET-INSTRUCTIONS" }, git: { commit_hash: "abc", branch: "main", repository_url: "git@github.com:me/demo-repo.git" }, ...extra }),
    turn: (t = "turn-1", dir = cwd) => { turn.id = t; return [L("event_msg", { type: "task_started", turn_id: t }), L("turn_context", { cwd: dir, model: "gpt", approval_policy: "on-request" })]; },
    item: (item) => L("event_msg", { type: "item_completed", thread_id: id, turn_id: turn.id, item }),
    ri: (payload) => L("response_item", { ...payload, internal_chat_message_metadata_passthrough: { turn_id: turn.id } }),
    raw: (type, payload) => L(type, payload),
  };
}

function file(t, id, lines, { dir = join(t.cfg.codexDir, "sessions", "2026", "10", "01") } = {}) {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `rollout-2026-10-01T12-00-00-${id}.jsonl`);
  writeFileSync(f, jsonl(lines));
  return f;
}

const steps = (t, id) => t.listener.listSteps(id);
const calls = (ss) => ss.filter((s) => s.kind === "tool_call" || s.kind === "edit");
const resultOf = (ss, call) => ss.find((s) => s.kind === "tool_result" && s.toolUseId === call.toolUseId);

/** A new-format thread: a prompt, Codex's own context turns, a read, a failing command, a search, edits, MCP, web. */
function newThread(id, cwd = ROOT) {
  const c = codex(id, { cwd });
  const userText = "fix the login bug";
  return [
    c.meta(),
    ...c.turn(),
    c.ri({ type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions instructions>sandboxed</permissions instructions>" }] }),
    c.ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/work/demo-repo</cwd>\n</environment_context>" }] }),
    c.ri({ type: "message", role: "user", content: [{ type: "input_text", text: userText }] }),
    c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: userText, text_elements: [] }] }),
    c.ri({ type: "reasoning", summary: [{ type: "summary_text", text: "Looking at the login flow" }], encrypted_content: "gAAAA-encrypted" }),
    c.item({ type: "Reasoning", id: "rs_1", summary_text: ["Looking at the login flow"], raw_content: [] }),
    c.item({ type: "Reasoning", id: "rs_1", summary_text: [], raw_content: [] }),
    c.item({ type: "AgentMessage", id: uuid(), content: [{ type: "Text", text: "I'll read the login code first." }], phase: "commentary" }),
    c.ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "I'll read the login code first." }] }),
    // A script calling exec_command: the command item is the step, the script itself isn't.
    c.ri({ type: "custom_tool_call", call_id: "call_exec1", name: "exec", input: 'const r = await tools.exec_command({"cmd":"sed -n 1,80p src/login.ts","workdir":"/work/demo-repo"}); text(r.output);' }),
    c.item({ type: "CommandExecution", id: "exec-0000-read", command: ["/bin/zsh", "-lc", "sed -n 1,80p src/login.ts"], cwd: "file:///work/demo-repo", parsed_cmd: [{ type: "read", cmd: "sed -n 1,80p src/login.ts", name: "login.ts", path: "src/login.ts" }], source: "unified_exec_startup", status: "completed", stdout: "export function login() {}\n", stderr: "", aggregated_output: "export function login() {}\n", exit_code: 0 }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_exec1", output: [{ type: "input_text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, { type: "input_text", text: "export function login() {}\n" }] }),
    c.item({ type: "CommandExecution", id: "exec-0000-test", command: ["/bin/zsh", "-lc", "npm test"], cwd: "file:///work/demo-repo", parsed_cmd: [{ type: "unknown", cmd: "npm test" }], status: "failed", stdout: "", stderr: "1 failing", aggregated_output: "1 failing\n", exit_code: 1 }),
    c.item({ type: "CommandExecution", id: "exec-0000-grep", command: ["/bin/zsh", "-lc", "rg -n token src"], cwd: "file:///work/demo-repo", parsed_cmd: [{ type: "search", cmd: "rg -n token src", query: "token", path: "src" }], status: "completed", stdout: "src/login.ts:3:token", stderr: "", aggregated_output: "src/login.ts:3:token", exit_code: 0 }),
    // A direct apply_patch: its FileChange item is the edit; the call and its output add nothing.
    c.ri({ type: "custom_tool_call", call_id: "call_patch1", name: "apply_patch", input: "*** Begin Patch\n*** Update File: src/login.ts\n@@\n-export function login() {}\n+export function login() { return check(); }\n*** End Patch\n" }),
    c.item({ type: "FileChange", id: "call_patch1", changes: {
      "/work/demo-repo/src/login.ts": { type: "update", unified_diff: "@@ -1,3 +1,3 @@\n import { check } from './check';\n-export function login() {}\n+export function login() { return check(); }\n // end\n", move_path: null },
      "/work/demo-repo/docs/notes.md": { type: "add", content: "# Notes\nLogin fixed.\n" },
    }, status: "completed", stdout: "Success. Updated the following files:\nM src/login.ts\nA docs/notes.md\n" }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_patch1", output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess." }),
    c.item({ type: "McpToolCall", id: "exec-0000-mcp", server: "github", tool: "get_issue", arguments: { number: 3 }, status: "completed", result: { content: [{ type: "text", text: "Issue 3: login fails" }], isError: false } }),
    c.item({ type: "WebSearch", id: "ws_0000000000000000000001", query: "zod refine async", action: { type: "search", query: "zod refine async", queries: ["zod refine async"] } }),
    c.item({ type: "AgentMessage", id: uuid(), content: [{ type: "Text", text: "Fixed: login now checks the token." }], phase: "final_answer" }),
    c.raw("event_msg", { type: "task_complete", turn_id: "turn-1" }),
  ];
}

test("a Codex thread end to end: prompt, reply, read, command, search, edits, MCP, web search; no duplicates", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000001";
  const f = file(t, id, newThread(id));
  await t.readNow(f, true);

  const [s] = t.listener.listSessions();
  assert.equal(s.id, id);
  assert.equal(s.harness, "codex");
  assert.equal(s.title, "fix the login bug");
  assert.equal(s.cwd, ROOT);

  const ss = steps(t, id);
  assert.deepEqual(ss.filter((x) => x.kind === "prompt").map((x) => x.text), ["fix the login bug"], "one prompt: Codex's context turns and the model's copy aren't prompts");
  assert.deepEqual(ss.filter((x) => x.kind === "thinking").map((x) => x.text), ["Looking at the login flow"], "empty reasoning is left out, the model's copy too");
  assert.deepEqual(ss.filter((x) => x.kind === "text").map((x) => x.text), ["I'll read the login code first.", "Fixed: login now checks the token."]);
  assert.deepEqual(calls(ss).map((x) => x.tool), ["Read", "Bash", "Grep", "Edit", "Write", "mcp__github__get_issue", "WebSearch"]);

  const read = calls(ss).find((x) => x.tool === "Read");
  assert.equal(read.filePath, "/work/demo-repo/src/login.ts");
  assert.equal(read.input.file_path, "/work/demo-repo/src/login.ts");
  assert.equal(resultOf(ss, read).text, "export function login() {}\n");

  const bash = calls(ss).find((x) => x.tool === "Bash");
  assert.equal(bash.input.command, "npm test");
  const failed = resultOf(ss, bash);
  assert.deepEqual(failed.input, { isError: true, toolUseId: bash.toolUseId });
  assert.match(failed.text, /^Exit code 1\n1 failing/);

  const grep = calls(ss).find((x) => x.tool === "Grep");
  assert.equal(grep.input.pattern, "token");
  assert.equal(grep.input.path, "/work/demo-repo/src");

  const edit = ss.find((x) => x.kind === "edit" && x.tool === "Edit");
  assert.equal(edit.filePath, "/work/demo-repo/src/login.ts");
  assert.deepEqual(edit.diff, { before: "import { check } from './check';\nexport function login() {}\n// end", after: "import { check } from './check';\nexport function login() { return check(); }\n// end" });
  assert.match(edit.input.unified_diff, /^@@ -1,3/);
  const write = ss.find((x) => x.kind === "edit" && x.tool === "Write");
  assert.equal(write.filePath, "/work/demo-repo/docs/notes.md");
  assert.deepEqual(write.diff, { before: "", after: "# Notes\nLogin fixed.\n" });

  const mcp = calls(ss).find((x) => x.tool.startsWith("mcp__"));
  assert.deepEqual(mcp.input, { number: 3 });
  assert.equal(resultOf(ss, mcp).text, "Issue 3: login fails");
  assert.equal(calls(ss).find((x) => x.tool === "WebSearch").input.query, "zod refine async");

  // Every call has its result (stored together: none looks held up), and nothing leaks the system prompt.
  for (const c of calls(ss)) assert.ok(resultOf(ss, c), `${c.tool} has a result`);
  assert.equal(ss.filter((x) => x.kind === "tool_result").length, calls(ss).length);
  assert.ok(!JSON.stringify(ss).includes("SECRET-INSTRUCTIONS"));
  assert.ok(!JSON.stringify(ss).includes("encrypted"));
  assert.equal(new Set(ss.map((x) => x.id)).size, ss.length);

  // Read again from the start (a rebuilt database): the same steps, nothing doubled.
  t.listener.saveOffset(f, 0);
  await t.readNow(f, true);
  assert.equal(steps(t, id).length, ss.length);
  await t.close();
});

test("Codex Desktop's context around a prompt is set apart; Codex's injected turns and secrets never become prompts", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000002";
  const c = codex(id);
  const f = file(t, id, [
    c.meta(), ...c.turn(),
    c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "<environment_context>\n<cwd>/work/demo-repo</cwd>\n</environment_context>" }] }),
    c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "# AGENTS.md instructions for /work/demo-repo\n\nBe nice." }] }),
    c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "# Files mentioned by the user:\n\n## a.ts: /work/demo-repo/a.ts\n\n## My request for Codex:\nrename the helper, key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop" }, { type: "local_image", path: "/tmp/shot.png" }] }),
  ]);
  await t.readNow(f, true);
  const prompts = steps(t, id).filter((x) => x.kind === "prompt");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].text, /^<files-mentioned-by-the-user>\n## a\.ts: \/work\/demo-repo\/a\.ts\n<\/files-mentioned-by-the-user>\n\nrename the helper/);
  assert.match(prompts[0].text, /\[Image: shot\.png\]$/);
  assert.ok(!prompts[0].text.includes("ABCDEFGHIJKLMNOP"), "secrets are masked");
  assert.match(t.listener.listSessions()[0].title, /^rename the helper, key /);
  await t.close();
});

test("resuming mid-file after a restart: the thread id comes from the file, not from lines already read", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000003";
  const lines = newThread(id);
  const f = file(t, id, lines);
  // As if a run before had stored everything up to the first agent message.
  const cut = lines.findIndex((l) => l.payload?.item?.type === "AgentMessage");
  t.listener.saveOffset(f, Buffer.byteLength(jsonl(lines.slice(0, cut))));
  await t.readNow(f, true);
  const ss = steps(t, id);
  assert.ok(ss.length > 0);
  assert.ok(ss.every((s) => s.sessionId === id));
  assert.equal(ss.filter((s) => s.kind === "prompt").length, 0, "the prompt was before the offset");
  assert.deepEqual(calls(ss).map((x) => x.tool), ["Read", "Bash", "Grep", "Edit", "Write", "mcp__github__get_issue", "WebSearch"]);
  assert.equal(t.listener.listSessions()[0].cwd, ROOT, "the thread's folder comes from the file's first line too");
  await t.close();
});

test("scope: a thread in another folder isn't read; one in a Codex worktree of the open repo is, on the main checkout's paths", async () => {
  const t = await makeListener({ root: ROOT });
  const other = "01a0c950-b6a2-77f3-aab6-000000000004";
  const fo = file(t, other, newThread(other, "/elsewhere/project"));
  // A Codex worktree whose .git file points at the repo's main checkout.
  const wt = join(t.cfg.codexDir, "worktrees", "1e13", "demo-repo");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), "gitdir: /work/demo-repo/.git/worktrees/demo-repo\n");
  const inWt = "01a0c950-b6a2-77f3-aab6-000000000005";
  const c = codex(inWt, { cwd: wt });
  const fw = file(t, inWt, [
    c.meta(), ...c.turn("turn-1", wt),
    c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "audit the repo" }] }),
    c.item({ type: "CommandExecution", id: "exec-wt-read", command: ["/bin/zsh", "-lc", "cat app.vue"], cwd: `file://${wt}`, parsed_cmd: [{ type: "read", cmd: "cat app.vue", name: "app.vue", path: "app.vue" }], status: "completed", aggregated_output: "<template/>", exit_code: 0 }),
    c.item({ type: "FileChange", id: "exec-wt-edit", changes: { [`${wt}/css/main.css`]: { type: "update", unified_diff: "@@ -1 +1 @@\n-a{}\n+b{}\n", move_path: `${wt}/css/site.css` } }, status: "completed", stdout: "Success." }),
  ]);
  // A thread in a worktree Codex has removed since: the repo is found by its folder name.
  const gone = "01a0c950-b6a2-77f3-aab6-000000000006";
  const g = codex(gone, { cwd: join(t.cfg.codexDir, "worktrees", "9f9f", "demo-repo") });
  const fg = file(t, gone, [g.meta(), ...g.turn(), g.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "old worktree" }] })]);

  for (const f of [fo, fw, fg]) await t.readNow(f, true);
  assert.equal(steps(t, other).length, 0, "another project's thread isn't read");
  const listed = t.listener.listSessions();
  assert.deepEqual(listed.map((s) => s.id).sort(), [inWt, gone].sort());
  assert.equal(listed.find((s) => s.id === inWt).cwd, ROOT);
  assert.equal(listed.find((s) => s.id === gone).cwd, ROOT);
  const ss = steps(t, inWt);
  const read = ss.find((s) => s.tool === "Read");
  assert.equal(read.filePath, "/work/demo-repo/app.vue");
  assert.equal(read.input.file_path, "/work/demo-repo/app.vue");
  const edit = ss.find((s) => s.kind === "edit");
  assert.equal(edit.filePath, "/work/demo-repo/css/site.css", "a move lands on the new path");
  assert.equal(edit.input.from, "/work/demo-repo/css/main.css");
  assert.deepEqual(edit.diff, { before: "a{}", after: "b{}" });

  // history lists only the project's files, archived ones included
  const archived = join(t.cfg.codexDir, "archived_sessions");
  const arch = "01a0c950-b6a2-77f3-aab6-000000000007";
  const fa = file(t, arch, newThread(arch), { dir: archived });
  const source = t.listener.sources.find((s) => s.harness === "codex");
  const scope = t.listener.scope();
  assert.deepEqual(source.list(scope).map((x) => x.path).sort(), [fw, fg, fa].sort());
  assert.equal(source.owns(fa), true);
  assert.equal(source.owns(join(t.tmp, "elsewhere.jsonl")), false);
  await t.close();
});

test("Codex's approval reviewer threads (guardian) aren't threads to show", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000008";
  const f = file(t, id, newThread(id).map((l) => (l.type === "session_meta" ? { ...l, payload: { ...l.payload, source: { subagent: { other: "guardian" } } } } : l)));
  await t.readNow(f, true);
  assert.equal(steps(t, id).length, 0);
  await t.close();
});

test("before Codex logged commands as items: commands from its scripts and calls, once; a turn a newer Codex logged isn't doubled", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000009";
  const c = codex(id, { version: "0.146.0-alpha.3" });
  const lines = [
    c.meta(), ...c.turn("turn-1"),
    c.item({ type: "UserMessage", id: "item-1", content: [{ type: "text", text: "list the files" }] }),
    c.ri({ type: "custom_tool_call", call_id: "call_x1", name: "exec", input: 'const a = await tools.exec_command({"cmd":"ls -la","workdir":"/work/demo-repo"}); const b = await tools.exec_command({"cmd":"git status"}); await tools.update_plan({"plan":[{"step":"Look around","status":"in_progress"}]}); text(a.output + b.output);' }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_x1", output: [{ type: "input_text", text: "Script failed\nWall time 0.2 seconds\nOutput:\n" }, { type: "input_text", text: "fatal: not a git repository" }] }),
    c.ri({ type: "function_call", call_id: "call_x2", name: "exec_command", arguments: JSON.stringify({ cmd: "pwd", workdir: ROOT }) }),
    c.ri({ type: "function_call_output", call_id: "call_x2", output: "Chunk ID: ab12cd\nWall time: 0.1 seconds\nProcess exited with code 0\nOriginal token count: 3\nOutput:\n/work/demo-repo\n" }),
    c.ri({ type: "function_call", call_id: "call_x2b", name: "shell_command", arguments: JSON.stringify({ command: "sed -n '1,40p' src/app.ts && cat 'docs/read me.md'", workdir: ROOT }) }),
    c.ri({ type: "function_call_output", call_id: "call_x2b", output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nexport {}\n" }),
    // apply_patch with no FileChange item (as some early-2026 Codex versions logged): the patch is the edit.
    c.ri({ type: "custom_tool_call", call_id: "call_x3", name: "apply_patch", input: "*** Begin Patch\n*** Update File: README.md\n@@\n # Demo\n-old line\n+new line\n*** Add File: docs/new.md\n+hello\n+world\n*** Delete File: junk.txt\n*** End Patch\n" }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_x3", output: JSON.stringify({ output: "Success. Updated the following files:\nM README.md\n", metadata: { exit_code: 0 } }) }),
    // Resumed in a newer Codex: this turn's command has an item.
    ...c.turn("turn-2"),
    c.item({ type: "UserMessage", id: "item-2", content: [{ type: "text", text: "and now?" }] }),
    c.ri({ type: "custom_tool_call", call_id: "call_x4", name: "exec", input: 'const r = await tools.exec_command({"cmd":"npm run build"}); text(r.output);' }),
    c.item({ type: "CommandExecution", id: "exec-new-1", command: ["/bin/zsh", "-lc", "npm run build"], cwd: "file:///work/demo-repo", parsed_cmd: [{ type: "unknown", cmd: "npm run build" }], status: "completed", aggregated_output: "built", exit_code: 0 }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_x4", output: [{ type: "input_text", text: "Script completed\nWall time 1 seconds\nOutput:\nbuilt" }] }),
    ...c.turn("turn-3"),
    c.ri({ type: "custom_tool_call", call_id: "call_x5", name: "exec", input: 'await tools.exec_command({"cmd":"npm test"})' }),
    c.item({ type: "CommandExecution", id: "exec-new-2", command: ["/bin/zsh", "-lc", "npm test"], cwd: "file:///work/demo-repo", parsed_cmd: [{ type: "unknown", cmd: "npm test" }], status: "completed", aggregated_output: "ok", exit_code: 0 }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_x5", output: "Script completed\nOutput:\nok" }),
  ];
  const f = file(t, id, lines);
  await t.readNow(f, true);
  const ss = steps(t, id);
  assert.deepEqual(calls(ss).map((x) => [x.tool, x.input.command ?? x.filePath ?? ""]), [
    ["TodoWrite", ""], ["Bash", "ls -la"], ["Bash", "git status"], ["Bash", "pwd"],
    ["Read", "sed -n '1,40p' src/app.ts && cat 'docs/read me.md'"], ["Read", "sed -n '1,40p' src/app.ts && cat 'docs/read me.md'"],
    ["Edit", "/work/demo-repo/README.md"], ["Write", "/work/demo-repo/docs/new.md"], ["Edit", "/work/demo-repo/junk.txt"],
    ["Bash", "npm run build"], ["Bash", "npm test"],
  ]);
  assert.deepEqual(calls(ss)[0].input.todos, [{ content: "Look around", status: "in_progress" }]);
  const gitStatus = resultOf(ss, calls(ss)[2]);
  assert.equal(gitStatus.input?.isError, true, "the failed script's last command is marked failed");
  assert.equal(resultOf(ss, calls(ss)[3]).text, "/work/demo-repo\n");
  assert.deepEqual(calls(ss).filter((x) => x.tool === "Read").map((x) => x.filePath), ["/work/demo-repo/src/app.ts", "/work/demo-repo/docs/read me.md"], "a plain read lands on the map");
  const readme = calls(ss)[6];
  assert.deepEqual(readme.diff, { before: "# Demo\nold line", after: "# Demo\nnew line" });
  assert.deepEqual(calls(ss)[7].diff, { before: "", after: "hello\nworld" });
  assert.equal(calls(ss)[8].input.deleted, true);
  for (const c of calls(ss)) assert.ok(resultOf(ss, c), `${c.tool} has a result`);

  // The same file read again from the middle of turn 3 (after a restart): turn 3's command still isn't doubled.
  const t2 = await makeListener({ root: ROOT });
  const f2 = file(t2, id, lines);
  const at = lines.findIndex((l) => l.payload?.call_id === "call_x5");
  t2.listener.saveOffset(f2, Buffer.byteLength(jsonl(lines.slice(0, at))));
  await t2.readNow(f2, true);
  assert.deepEqual(calls(steps(t2, id)).map((x) => x.input.command), ["npm test"]);
  await t2.close();
  await t.close();
});

test("an old-format Codex file (no items): prompts, replies, reasoning, commands and patches from the model's records", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000010";
  const c = codex(id, { version: "0.40.0" });
  const f = file(t, id, [
    c.meta(),
    c.ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<user_instructions>\nbe brief\n</user_instructions>" }] }),
    c.ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/work/demo-repo</cwd>\n</environment_context>" }] }),
    c.ri({ type: "message", role: "user", content: [{ type: "input_text", text: "add a readme" }] }),
    c.raw("event_msg", { type: "user_message", message: "add a readme" }),
    c.ri({ type: "reasoning", summary: [{ type: "summary_text", text: "Plan the readme" }] }),
    c.ri({ type: "function_call", call_id: "call_o1", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "ls"], workdir: ROOT }) }),
    c.ri({ type: "function_call_output", call_id: "call_o1", output: JSON.stringify({ output: "src\n", metadata: { exit_code: 0 } }) }),
    c.ri({ type: "custom_tool_call", call_id: "call_o2", name: "apply_patch", input: "*** Begin Patch\n*** Add File: README.md\n+# Demo\n*** End Patch" }),
    c.ri({ type: "custom_tool_call_output", call_id: "call_o2", output: "Success." }),
    c.ri({ type: "function_call", call_id: "call_o3", name: "search_docs", arguments: JSON.stringify({ q: "readme" }) }),
    c.ri({ type: "function_call_output", call_id: "call_o3", output: "nothing" }),
    c.ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Added README.md." }] }),
    c.raw("event_msg", { type: "agent_message", message: "Added README.md." }),
  ]);
  await t.readNow(f, true);
  const ss = steps(t, id);
  assert.deepEqual(ss.filter((x) => x.kind !== "tool_result").map((x) => [x.kind, x.tool ?? x.text]), [
    ["prompt", "add a readme"], ["thinking", "Plan the readme"], ["tool_call", "Bash"], ["edit", "Write"], ["tool_call", "search_docs"], ["text", "Added README.md."],
  ]);
  assert.equal(calls(ss)[0].input.command, "ls");
  assert.equal(calls(ss)[1].filePath, "/work/demo-repo/README.md");
  assert.equal(t.listener.listSessions()[0].title, "add a readme");
  await t.close();
});

test("questions to the person wait for an answer; plans are TodoWrite", async () => {
  const t = await makeListener({ root: ROOT });
  const id = "01a0c950-b6a2-77f3-aab6-000000000011";
  const c = codex(id);
  const lines = [
    c.meta(), ...c.turn(),
    c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "set up the server" }] }),
    c.ri({ type: "function_call", call_id: "call_plan", name: "update_plan", arguments: JSON.stringify({ explanation: "steps", plan: [{ step: "Create it", status: "completed" }, { step: "Invite people", status: "pending" }] }) }),
    c.ri({ type: "function_call_output", call_id: "call_plan", output: "Plan updated" }),
    c.ri({ type: "function_call", call_id: "call_ask", name: "request_user_input_async", arguments: JSON.stringify({ questions: [{ title: "May I accept the guidelines?", options: ["Yes", "No, I'll do it"] }] }) }),
    c.ri({ type: "function_call_output", call_id: "call_ask", output: '{"accepted":true}' }),
  ];
  const f = file(t, id, lines);
  await t.readNow(f, true);
  let ss = steps(t, id);
  const plan = calls(ss).find((x) => x.tool === "TodoWrite");
  assert.deepEqual(plan.input.todos, [{ content: "Create it", status: "completed" }, { content: "Invite people", status: "pending" }]);
  assert.ok(resultOf(ss, plan));
  const ask = calls(ss).find((x) => x.tool === "AskUserQuestion");
  assert.deepEqual(ask.input, { questions: [{ question: "May I accept the guidelines?", options: [{ label: "Yes" }, { label: "No, I'll do it" }] }] });
  assert.equal(resultOf(ss, ask), undefined, "no answer yet");

  appendFileSync(f, jsonl([c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: '<send_user_message_question_reply>\nuser: [{"questionItemId":"[\\"request_user_input_async\\",\\"call_ask\\",0]","question":"May I accept the guidelines?","answers":["Yes"]}]\n</send_user_message_question_reply>' }] })]));
  await t.readNow(f, true);
  ss = steps(t, id);
  assert.equal(resultOf(ss, ask)?.text, "Yes");
  assert.equal(ss.filter((x) => x.kind === "prompt").length, 1, "the answer isn't a new prompt");
  await t.close();
});

test("Claude Code and Codex threads side by side, each with its harness", async () => {
  const t = await makeListener({ root: ROOT });
  const cf = join(t.projectDir, "claude-1.jsonl");
  writeFileSync(cf, jsonl([line("prompt", { sessionId: "claude-1", cwd: ROOT, i: 0, text: "hello claude" }), line("tool", { sessionId: "claude-1", cwd: ROOT, i: 1 })]));
  const id = "01a0c950-b6a2-77f3-aab6-000000000012";
  const f = file(t, id, newThread(id));
  await t.readNow(cf, true);
  await t.readNow(f, true);
  const byId = Object.fromEntries(t.listener.listSessions().map((s) => [s.id, s.harness]));
  assert.deepEqual(byId, { "claude-1": "claude", [id]: "codex" });
  await t.close();
});

test("watching: a new Codex thread is read live; no Codex folder at all is fine", async () => {
  // No ~/.codex: the listener still gets ready.
  const none = await makeListener({ root: ROOT, watch: true });
  const end = Date.now() + 10_000;
  while (!none.listener.ready && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.equal(none.listener.ready, true);
  await none.close();

  const tmp = mkdtempSync(join(tmpdir(), "bs-codex-"));
  process.env.RUNDOWN_DATA_DIR = join(tmp, "data");
  process.env.RUNDOWN_CLAUDE_DIR = join(tmp, "claude");
  process.env.RUNDOWN_CODEX_DIR = join(tmp, "codex");
  process.env.MAP_ROOT = ROOT;
  const day = join(tmp, "codex", "sessions", "2026", "10", "01");
  mkdirSync(day, { recursive: true });
  mkdirSync(process.env.RUNDOWN_CLAUDE_DIR, { recursive: true });
  const { DbService } = require(dist("core/db.service.js"));
  const { BusService } = require(dist("core/bus.service.js"));
  const { ConfigService } = require(dist("core/config.service.js"));
  const { ListenerService } = require(dist("listener/listener.service.js"));
  const sent = [];
  const dbs = new DbService();
  const L = new ListenerService(dbs, new BusService(), { broadcast: (m) => sent.push(m) }, new ConfigService());
  L.onModuleInit();
  const until = async (cond) => { const e = Date.now() + 10_000; while (!cond()) { if (Date.now() > e) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); } };
  try {
    await until(() => L.ready);
    const id = "01a0c950-b6a2-77f3-aab6-000000000013";
    const lines = newThread(id);
    const f = join(day, `rollout-2026-10-01T12-00-00-${id}.jsonl`);
    writeFileSync(f, jsonl(lines.slice(0, 7))); // up to the prompt
    await until(() => L.listSessions().length === 1);
    appendFileSync(f, jsonl(lines.slice(7)));
    await until(() => L.listSteps(id).some((s) => s.tool === "WebSearch"));
    assert.ok(sent.some((m) => m.type === "step" && m.step.tool === "Read"), "live steps are broadcast");
  } finally {
    await L.onModuleDestroy();
    dbs.db.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a turn Codex finishes live tells attention it's your turn; one in history doesn't", async () => {
  const t = await makeListener();
  const id = uuid();
  const c = codex(id);
  const f = file(t, id, [c.meta(), ...c.turn(), c.item({ type: "UserMessage", id: uuid(), content: [{ type: "text", text: "rename it" }] }), c.raw("event_msg", { type: "task_complete", turn_id: "turn-1" })]);
  const ended = [];
  t.bus.on("turn-ended", (e) => ended.push(e.sessionId));
  await t.readNow(f, true);
  assert.deepEqual(ended, [], "history isn't news");
  t.live();
  appendFileSync(f, jsonl([...c.turn("turn-2"), c.item({ type: "AgentMessage", id: uuid(), content: [{ type: "Text", text: "Renamed." }] }), c.raw("event_msg", { type: "task_complete", turn_id: "turn-2" })]));
  await t.readNow(f);
  assert.deepEqual(ended, [id]);
  await t.close();
});

test("the workspace picker's Codex projects: a Codex worktree counts as its repo, reviewers and dated scratch folders don't count", async () => {
  const t = await makeListener();
  const repo = mkdtempSync(join(tmpdir(), "codex-repo-"));
  mkdirSync(join(repo, ".git", "worktrees", "repo"), { recursive: true });
  const wt = join(t.cfg.codexDir, "worktrees", "ab12", "repo");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "repo")}\n`);
  const a = uuid(), b = uuid(), r = uuid(), s = uuid();
  file(t, a, [codex(a, { cwd: repo }).meta()]);
  file(t, b, [codex(b, { cwd: wt }).meta()]);
  file(t, r, [codex(r, { cwd: repo, source: { subagent: { other: "guardian" } } }).meta()]);
  file(t, s, [codex(s, { cwd: "/Users/me/Documents/Codex/2026-09-23" }).meta()]);
  const projects = t.listener.codexProjects();
  assert.deepEqual([...projects.keys()], [repo]);
  assert.deepEqual(projects.get(repo).map((x) => x.id).sort(), [a, b].sort());
  rmSync(repo, { recursive: true, force: true });
  await t.close();
});
