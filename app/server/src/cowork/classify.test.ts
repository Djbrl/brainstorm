import test from "node:test";
import assert from "node:assert/strict";
import { CoworkTracker, shellEvents, simpleCommands } from "./classify";
import type { Step } from "../shared/contract";

const sh = (cmd: string, result = "", failed = false) => shellEvents(cmd, result, failed);
const one = (cmd: string, result = "", failed = false) => { const e = sh(cmd, result, failed); assert.equal(e.length, 1, cmd); return e[0]; };

let n = 0;
const call = (tool: string, input: Record<string, unknown>): Step => ({ id: `c${++n}`, sessionId: "s", seq: n, ts: "2026-10-11T10:00:00.000Z", kind: "tool_call", tool, input, toolUseId: `u${n}` });
const handle = (tool: string, input: Record<string, unknown> = {}, text = "ok") => new CoworkTracker("s").handle(call(tool, input), { ...call(tool, {}), kind: "tool_result", text });

test("commands are split quote-aware", () => {
  assert.deepEqual(simpleCommands(`echo "a && git push" && ls`), [["echo", "a && git push"], ["ls"]]);
  assert.deepEqual(simpleCommands("FOO=1 sudo git push origin main | tee log"), [["git", "push", "origin", "main"], ["tee", "log"]]);
  assert.equal(sh(`echo "git push origin main; vercel --prod"`).length, 0);
  assert.equal(sh(`git commit -m "then git push" && echo ok`).length, 0);
});

test("git push: a real push, a rehearsal, a delete, nothing new", () => {
  assert.equal(one("git push origin main").change?.verb, "pushed");
  assert.equal(sh("git push --dry-run origin main").length, 0);
  assert.equal(sh("git push -n origin main").length, 0);
  const del = one("git push origin --delete old-branch");
  assert.equal(del.change?.verb, "deleted");
  assert.equal(one("git push", "Everything up-to-date").action, "read");
});

test("a failed push is not a change, but a commit message saying 'not found' does not fail it", () => {
  assert.equal(one("git push origin main", "! [rejected]  main -> main (fetch first)").change, undefined);
  assert.equal(one("git push origin main", "   abc..def  main -> main\n[main abc] fix: page not found handling").failed, false);
  assert.equal(one("vercel --prod", "bash: vercel: command not found").failed, true);
});

test("curl: methods and bodies", () => {
  assert.equal(one("curl https://api.example.com/x").action, "read");
  assert.equal(one("curl -X DELETE https://api.example.com/x").change?.verb, "deleted");
  assert.equal(one("curl --request DELETE https://api.example.com/x").change?.verb, "deleted");
  assert.equal(one("curl --request=POST https://api.example.com/x").action, "write");
  assert.equal(one("curl --json '{\"a\":1}' https://api.example.com/x").action, "write");
  assert.equal(one("curl -d a=1 https://api.example.com/x").action, "write");
  assert.equal(one("curl -X GET https://api.example.com/x").action, "read");
});

test("gh api: the method decides, fields imply a write", () => {
  assert.equal(one("gh api repos/o/r/issues").action, "read");
  assert.equal(one("gh api -X DELETE repos/o/r/issues/1").change?.verb, "deleted");
  assert.equal(one("gh api --method PATCH repos/o/r -f name=x").action, "write");
  assert.equal(one("gh api repos/o/r/issues -f title=x").action, "write");
  assert.equal(one("gh api repos/o/r/issues -f title=x --method GET").action, "read");
  assert.equal(one("gh api graphql -f query='query { viewer { login } }'").action, "read");
});

test("other outward programs", () => {
  assert.equal(one("vercel --prod").change?.verb, "deployed");
  assert.equal(one("npm publish").change?.verb, "published");
  assert.equal(one("gh pr create --fill").change?.verb, "created");
  assert.equal(sh("ls && cat README.md").length, 0);
});

test("connector tools: the verb is the first whole word", () => {
  assert.equal(handle("mcp__abc__create_event", { title: "Lunch" })[0].change?.verb, "created");
  assert.equal(handle("mcp__abc__createEvent", { title: "Lunch" })[0].change?.verb, "created");
  assert.equal(handle("mcp__abc__settings_get")[0]?.change, undefined);
  assert.equal(handle("mcp__abc__setup_status")[0]?.change, undefined);
  assert.equal(handle("mcp__abc__news_feed")[0]?.change, undefined);
  assert.equal(handle("mcp__abc__address_lookup")[0]?.change, undefined);
  assert.equal(handle("mcp__abc__run_query")[0]?.change, undefined);
});

test("connector names: a named server keeps its own name", () => {
  assert.equal(handle("mcp__github__list_events")[0].site, "Github");
  assert.equal(handle("mcp__slack__send_message", { text: "hi" })[0].site, "Slack");
  assert.equal(handle("mcp__6dc6ee67-b9fd-46fe-bdce-cd306c0bcf47__list_events")[0].site, "Calendar");
  assert.equal(handle("mcp__6dc6ee67-b9fd-46fe-bdce-cd306c0bcf47__get_thread")[0].site, "Email");
  assert.equal(handle("mcp__claude_ai_Gmail__search_threads")[0].site, "Email");
});

test("a failed result flagged by the harness is a failed event", () => {
  const t = new CoworkTracker("s");
  const c = call("Bash", { command: "git push origin main" });
  const e = t.handle(c, { ...c, kind: "tool_result", text: "boom", input: { isError: true } });
  assert.equal(e[0].failed, true);
  assert.equal(e[0].change, undefined);
});
