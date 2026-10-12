// The Places classifier (classify.ts): which place a tool call touched (a web page, a local app, a connector, an app on
// the computer) and whether it changed something out there. One case per line, so a regression names itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CoworkEvent, Step } from "../shared/contract";
import { CoworkTracker, placeForUrl } from "./classify";

let n = 0;
const call = (tool: string, input: Record<string, unknown>): Step => ({ id: `c${++n}`, sessionId: "s", seq: n, ts: "2026-10-11T10:00:00.000Z", kind: "tool_call", tool, input, toolUseId: `u${n}` });
const result = (text: string, isError = false): Step => ({ id: `r${++n}`, sessionId: "s", seq: n, ts: "2026-10-11T10:00:01.000Z", kind: "tool_result", text, ...(isError ? { isError } : {}) });
/** One call on a fresh tracker (or on `t`, which remembers tabs and element names). */
const run = (tool: string, input: Record<string, unknown> = {}, text = "ok", t = new CoworkTracker("s"), isError = false): CoworkEvent[] => t.handle(call(tool, input), result(text, isError));
const one = (...a: Parameters<typeof run>) => { const e = run(...a); assert.equal(e.length, 1, JSON.stringify(e)); return e[0]; };
const B = "mcp__Claude_Browser__";

test("places: a URL becomes host and path, never its query or hash", () => {
  assert.deepEqual(placeForUrl("https://www.shop.example/cart/?token=abc#top"), { area: "web", site: "shop.example", page: "shop.example/cart", url: "https://www.shop.example/cart", title: undefined });
  assert.equal(placeForUrl("https://shop.example/")?.page, "shop.example");
});

test("places: local dev hosts are local, files are local files, other schemes and junk are nothing", () => {
  for (const u of ["http://localhost:5173/app", "http://127.0.0.1:4000", "http://shop.localhost/x", "http://api.test/v1", "http://[::1]:8080/"]) assert.equal(placeForUrl(u)?.area, "local", u);
  assert.deepEqual(placeForUrl("file:///work/acme/docs/plan.html"), { area: "local", site: "Local files", page: "file:/work/acme/docs/plan.html", url: "file:///work/acme/docs/plan.html", title: "docs/plan.html" });
  for (const u of ["mailto:a@b.example", "javascript:alert(1)", "not a url", undefined]) assert.equal(placeForUrl(u), null, String(u));
});

test("browser: opening a page is a visit; a failed one says so", () => {
  const e = one(`${B}navigate`, { url: "https://docs.example/guide" });
  assert.deepEqual([e.area, e.site, e.page, e.action, e.what], ["web", "docs.example", "docs.example/guide", "visit", "Opened the page"]);
  assert.equal(one(`${B}navigate`, { url: "https://docs.example/x" }, "net::ERR", new CoworkTracker("s"), true).what, "Couldn't open the page");
});

test("browser: housekeeping (tabs, resize) is no place at all", () => {
  for (const name of ["tabs_context", "tabs_create", "resize_window", "preview_list"]) assert.equal(run(`${B}${name}`).length, 0, name);
});

test("browser: reading a page happens on the tab's page", () => {
  const t = new CoworkTracker("s");
  run(`${B}navigate`, { url: "https://news.example/today" }, "ok", t);
  const e = one(`${B}get_page_text`, {}, "ok", t);
  assert.deepEqual([e.page, e.action, e.change], ["news.example/today", "read", undefined]);
});

test("browser: a click on a Send button is a likely change on the web, on a local app it's not", () => {
  const t = new CoworkTracker("s");
  run(`${B}navigate`, { url: "https://forms.example/f/1" }, 'button "Send" [ref_7]', t);
  const e = one(`${B}computer`, { action: "left_click", ref: "ref_7" }, "ok", t);
  assert.deepEqual([e.action, e.what, e.change], ["click", 'Clicked button "Send"', { verb: "sent", confidence: "likely" }]);
  const local = new CoworkTracker("s");
  run(`${B}navigate`, { url: "http://localhost:3000/" }, 'button "Delete" [ref_2]', local);
  assert.equal(one(`${B}computer`, { action: "left_click", ref: "ref_2" }, "ok", local).change, undefined);
});

test("browser: labels decide the verb (delete, publish, create, save), French too", () => {
  const verb = (label: string) => {
    const t = new CoworkTracker("s");
    run(`${B}navigate`, { url: "https://app.example/" }, `button "${label}" [ref_1]`, t);
    return one(`${B}computer`, { action: "left_click", ref: "ref_1" }, "ok", t).change?.verb;
  };
  assert.equal(verb("Delete project"), "deleted");
  assert.equal(verb("Publier"), "published");
  assert.equal(verb("Create issue"), "created");
  assert.equal(verb("Save changes"), "updated");
  assert.equal(verb("Envoyer"), "sent");
});

test("browser: a click on a link is just a click; an unnamed click maybe changed something", () => {
  const t = new CoworkTracker("s");
  run(`${B}navigate`, { url: "https://app.example/" }, 'link "Pricing" [ref_3]', t);
  assert.equal(one(`${B}computer`, { action: "left_click", ref: "ref_3" }, "ok", t).change, undefined);
  assert.deepEqual(one(`${B}computer`, { action: "left_click", coordinate: [10, 10] }, "ok", t).change, { verb: "clicked", confidence: "maybe" });
});

test("browser: typing then Enter submits; on a messaging site it sends", () => {
  const t = new CoworkTracker("s");
  run(`${B}navigate`, { url: "https://chat.slack.com/c/1" }, "ok", t);
  assert.deepEqual(one(`${B}computer`, { action: "type", text: "hello team" }, "ok", t).change, { verb: "typed", confidence: "maybe" });
  assert.deepEqual(one(`${B}computer`, { action: "key", text: "Return" }, "ok", t).change, { verb: "sent", confidence: "likely" });
  assert.equal(one(`${B}computer`, { action: "key", text: "Return" }, "ok", t).change, undefined); // nothing typed since
});

test("browser: a batch is one event per action, up to the one that failed", () => {
  const e = run(`${B}browser_batch`, { actions: [
    { name: "navigate", input: { url: "https://a.example/" } },
    { name: "get_page_text", input: {} },
    { name: "computer", input: { action: "screenshot" } },
  ] }, "actions[1] (get_page_text) failed");
  assert.deepEqual(e.map((x) => [x.tool, !!x.failed]), [["navigate", false], ["get_page_text", true]]);
  assert.deepEqual(e.map((x) => x.id), [`c${n - 1}#0`, `c${n - 1}#1`]);
});

test("browser: a script that clicks counts as a maybe-change on the web", () => {
  const t = new CoworkTracker("s");
  run(`${B}navigate`, { url: "https://app.example/" }, "ok", t);
  assert.deepEqual(one(`${B}javascript_tool`, { text: "document.querySelector('button').click()" }, "ok", t).change, { verb: "clicked", confidence: "maybe" });
  assert.equal(one(`${B}javascript_tool`, { text: "document.title" }, "ok", t).action, "read");
});

test("web tools: WebFetch reads the page, WebSearch is a search", () => {
  const f = one("WebFetch", { url: "https://api.example/docs?key=SECRET", prompt: "find the rate limits" });
  assert.deepEqual([f.page, f.action, f.what], ["api.example/docs", "read", "Fetched: find the rate limits"]);
  const s = one("WebSearch", { query: "Node 22 sqlite" });
  assert.deepEqual([s.area, s.site, s.action], ["web", "Web search", "search"]);
});

test("code tools and harness tools are not places", () => {
  for (const [tool, input] of [["Read", { file_path: "/w/a.ts" }], ["Edit", {}], ["Grep", {}], ["mcp__ccd_session__mark_chapter", {}], ["mcp__visualize__show_widget", {}]] as const) assert.equal(run(tool, input).length, 0, tool);
});

test("connectors: a create is a sure change; a list is a read; a search is a search", () => {
  const c = one("mcp__gcal__create_event", { summary: "Team sync" });
  assert.deepEqual([c.area, c.site, c.action, c.what, c.change], ["services", "Calendar", "write", "Created Team sync", { verb: "created", confidence: "sure" }]);
  assert.equal(one("mcp__acme_crm__add_contact", { name: "Lead 42" }).site, "Acme Crm");
  assert.equal(one("mcp__gcal__list_events", {}).action, "read");
  assert.equal(one("mcp__gmail__search_threads", {}).action, "search");
});

test("connectors: an opaque server id is named from its tools, and an opaque item id is shortened", () => {
  const id = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
  assert.equal(one(`mcp__${id}__create_event`, { summary: "Lunch" }).site, "Calendar");
  assert.equal(one(`mcp__${id}__send_message`, {}).site, "Email");
  const doc = one(`mcp__${id}__update`, { ref: { id: "dc2c64ba-2bb6-4c4d-9e9e-123456789abc" } });
  assert.deepEqual([doc.site, doc.title, doc.change?.verb], ["Docs", "Doc dc2c64ba", "updated"]);
});

test("connectors: a named server is never guessed from its tool names", () => {
  assert.equal(one("mcp__github__list_events", {}).site, "Github"); // not a calendar
});

test("Artifacts: publish, update, delete, read", () => {
  assert.equal(one("Artifact", { file_path: "/w/report.html" }).change?.verb, "published");
  assert.equal(one("Artifact", { url: "https://claude.ai/artifact/x", file_path: "/w/r.html" }).change?.verb, "updated");
  assert.equal(one("Artifact", { action: "delete", url: "https://claude.ai/artifact/x" }).change?.verb, "deleted");
  assert.equal(one("Artifact", { action: "list" }).action, "read");
  assert.equal(one("ArtifactData", { action: "batch", url: "u" }).change?.verb, "updated");
});

test("apps: the iOS simulator and computer use are apps on the computer", () => {
  const sim = one("mcp__Claude_Code_iOS_Simulator__control", { action: "tap", device: "iPhone 17" });
  assert.deepEqual([sim.area, sim.site, sim.action], ["apps", "iOS Simulator", "click"]);
  const cu = one("mcp__computer-use__left_click", { app: "Notes" });
  assert.deepEqual([cu.area, cu.site, cu.change?.verb], ["apps", "Notes", "clicked"]);
});

test("shell: outward commands are places, local ones are not", () => {
  assert.equal(one("Bash", { command: "git push origin main" }).change?.verb, "pushed");
  assert.equal(run("Bash", { command: "ls -la && npm test" }).length, 0);
});
