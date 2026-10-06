// Owner: cowork. Turns non-code tool calls (browser, web, connectors, outward CLIs) into places and actions.
// Pure: no Nest, no db. One tracker per session, fed call/result pairs in order. See docs/cowork.md.
import type { CoworkArea, CoworkConfidence, CoworkEvent, CoworkVerb, Step } from "../types";

type Tab = { url?: string; title?: string };
type Place = { area: CoworkArea; site: string; page: string; url?: string; title?: string };
type Draft = Omit<CoworkEvent, "id" | "stepId" | "sessionId" | "ts" | "area" | "site" | "page" | "title" | "failed"> & { place: Place | null; failed?: boolean };

const BROWSER_SERVERS = new Set(["Claude_Browser", "claude-in-chrome"]);
/** Harness and UI tools: not work on the outside world. */
const SKIP_SERVERS = new Set(["ccd_session", "ccd_session_mgmt", "ccd_view", "ccd_window", "ccd_sidebar", "ccd_settings", "ccd_directory", "ccd_host", "ccd_pr", "ccd_connectors", "visualize", "terminal", "mcp-registry"]);
const SKIP_TOOLS = new Set(["read_me", "show_widget"]);
/** Browser housekeeping that says nothing about the page. */
const BROWSER_NOISE = new Set(["tabs_context", "tabs_select", "tabs_create", "tabs_close", "resize_window", "preview_list", "preview_stop", "preview_logs", "list_connected_browsers", "select_browser", "switch_browser", "shortcuts_list", "gif_creator"]);
export const CODE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "Grep", "Glob", "Bash", "NotebookEdit"]);

/** Buttons whose click most likely changes something outside the computer. English and French (the Google Form says "Envoyer"). */
const COMMIT = /\b(send|submit|publish|post|reply|confirm|delete|remove|pay|buy|order|checkout|deploy|create|save|apply|book|sign up|register|upload|share|invite|envoyer|soumettre|publier|valider|supprimer|confirmer|enregistrer|créer|partager|payer|commander)\b/i;
const MESSAGING = /whatsapp|slack|messenger|discord|telegram|mail\.|outlook|teams\./i;
const FAILED = /^\s*(<tool_use_error>|error\b)|was denied or failed|is not allowed|not allowed|permission_required|timed out after|^\s*exit code [1-9]/i;

const short = (s: string, n = 48) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function isLocalHost(host: string) {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host) || /\.(localhost|test)(:\d+)?$/.test(host);
}

/** A page: host + path, no query or hash (they hold tokens and search terms, and split one page into many). */
export function placeForUrl(raw: string | undefined, title?: string): Place | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol === "file:") {
    const name = decodeURIComponent(u.pathname.split("/").filter(Boolean).slice(-2).join("/"));
    return { area: "local", site: "Local files", page: `file:${u.pathname}`, url: `file://${u.pathname}`, title: title || name };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.host.replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return { area: isLocalHost(u.host) ? "local" : "web", site: host, page: `${host}${path === "/" ? "" : path}`, url: `${u.protocol}//${u.host}${path}`, title };
}

function verbForLabel(label: string, host: string): CoworkVerb {
  if (/delete|remove|supprimer/i.test(label)) return "deleted";
  if (/publish|publier|deploy|share|partager/i.test(label)) return "published";
  if (/create|créer|sign up|register|book|invite/i.test(label)) return "created";
  if (/save|enregistrer|apply/i.test(label)) return "updated";
  if (/send|envoyer|reply|post/i.test(label) || MESSAGING.test(host)) return "sent";
  return "submitted";
}

/** Tab titles and urls from the "Tab Context" footer both browsers append to results. */
function parseTabContext(text: string): { executed?: string; tabs: Map<string, Tab> } {
  const tabs = new Map<string, Tab>();
  const re = /tabId (\S+?): "((?:[^"\\\n]|\\.)*)" \("?([^")\s]*)"?\)/g;
  for (let m; (m = re.exec(text)); ) tabs.set(m[1], { title: m[2] || undefined, url: m[3] || undefined });
  const executed = /Executed on tabId: (\S+)/.exec(text)?.[1];
  const page = /^Title: (.*)\nURL: (\S+)/m.exec(text); // get_page_text
  if (page && executed) tabs.set(executed, { title: page[1], url: page[2] });
  return { executed, tabs };
}

type Ctx = { result: string; resultFailed: boolean };

export class CoworkTracker {
  private tabs = new Map<string, Tab>();
  private lastTab = "default";
  /** Element names from find/read_page results, by "<tab>|ref_N": 'button "Envoyer"'. */
  private refs = new Map<string, { role: string; name: string }>();
  private typedIn = new Set<string>();
  /** Connector item titles learned from creates: id → "Rundown — Pitch…". */
  private itemTitles = new Map<string, string>();

  constructor(private sessionId: string) {}

  handle(call: Step, result: Step | undefined): CoworkEvent[] {
    const tool = call.tool ?? "";
    const input = (call.input ?? {}) as Record<string, any>;
    const text = result?.text ?? "";
    const resultFailed = !!(result?.input as { isError?: boolean } | undefined)?.isError || FAILED.test(text.slice(0, 300));
    const drafts: Draft[] = [];

    const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
    if (mcp && BROWSER_SERVERS.has(mcp[1])) {
      const name = mcp[2].replace(/_mcp$/, "");
      if (name === "browser_batch" && Array.isArray(input.actions)) {
        const failedAt = Number(/actions\[(\d+)\] \([^)]*\) failed/.exec(text)?.[1] ?? Infinity);
        input.actions.forEach((a: { name?: string; input?: Record<string, any> }, i: number) => {
          if (i > failedAt) return; // never ran
          drafts.push(...this.browser(String(a?.name ?? "").replace(/_mcp$/, ""), a?.input ?? {}, { result: text, resultFailed: i === failedAt }));
        });
      } else {
        drafts.push(...this.browser(name, input, { result: text, resultFailed }));
      }
      this.absorbResult(text);
    } else if (mcp) {
      if (!SKIP_SERVERS.has(mcp[1]) && !SKIP_TOOLS.has(mcp[2])) drafts.push(...this.service(mcp[1], mcp[2], input, resultFailed, text));
    } else {
      drafts.push(...this.builtin(tool, input, text, resultFailed));
    }

    return drafts.filter((d) => d.place).map((d, i, all) => ({
      id: all.length > 1 ? `${call.id}#${i}` : call.id,
      stepId: call.id, sessionId: this.sessionId, ts: call.ts,
      area: d.place!.area, site: d.place!.site, page: d.place!.page, title: d.place!.title,
      tool: d.tool, action: d.action, what: d.what,
      ...(d.change ? { change: d.change } : {}),
      ...(d.failed ? { failed: true } : {}),
    }));
  }

  // ---- browsers (in-app pane and Chrome) ----

  private browser(name: string, input: Record<string, any>, ctx: Ctx): Draft[] {
    if (BROWSER_NOISE.has(name)) return [];
    const ctxTabs = parseTabContext(ctx.result);
    const tab = String(input.tabId ?? ctxTabs.executed ?? this.lastTab);
    this.lastTab = tab;
    const before = this.tabs.get(tab) ?? ctxTabs.tabs.get(tab);
    const here = placeForUrl(before?.url, before?.title);
    const failed = ctx.resultFailed;
    const d = (action: Draft["action"], what: string, place = here, change?: Draft["change"]): Draft[] => [{ tool: name, action, what, place, change, failed }];

    if (name === "navigate" || (name === "preview_start" && input.url)) {
      const url = str(input.url);
      if (!url || url === "back" || url === "forward") {
        const after = ctxTabs.tabs.get(tab);
        return d("visit", url === "back" ? "Went back" : url === "forward" ? "Went forward" : "Opened a page", placeForUrl(after?.url, after?.title));
      }
      const place = placeForUrl(url, ctxTabs.tabs.get(tab)?.title);
      if (!failed) this.tabs.set(tab, { url, title: place?.title });
      this.typedIn.delete(tab);
      return d("visit", failed ? "Couldn't open the page" : "Opened the page", place);
    }
    if (name === "preview_start") return []; // dev server by name: the page shows up on the next call's tab context
    if (name === "get_page_text") return d("read", "Read the page text");
    if (name === "read_page") return d("read", "Read the page structure");
    if (name === "find") return d("read", `Looked for ${short(String(input.query ?? "an element"), 40)}`);
    if (name === "read_console_messages") return d("read", "Read the console");
    if (name === "read_network_requests") return d("read", "Read network requests");
    if (name === "javascript_tool") {
      const code = String(input.text ?? "");
      return /\.click\(\)|\.submit\(\)|requestSubmit|dispatchEvent|method:\s*["'`](POST|PUT|PATCH|DELETE)/i.test(code) && here?.area === "web"
        ? d("click", "Ran a script that clicks or sends", here, { verb: "clicked", confidence: "maybe" })
        : d("read", "Ran a script on the page");
    }
    if (name === "form_input") {
      const el = this.refName(tab, input.ref);
      this.typedIn.add(tab);
      return d("input", `Filled ${el ?? "a field"}${input.value !== undefined ? ` with "${short(String(input.value), 36)}"` : ""}`, here, this.webChange(here, "typed", "maybe"));
    }
    if (name === "file_upload" || name === "upload_image") return d("write", "Uploaded a file", here, this.webChange(here, "sent", "likely"));
    if (name !== "computer") return d("read", name.replace(/_/g, " "));

    const act = String(input.action ?? "");
    switch (act) {
      case "screenshot": case "zoom": return d("read", "Looked at the page");
      case "scroll": case "scroll_to": return d("read", "Scrolled");
      case "hover": return d("read", "Hovered");
      case "wait": return [];
      case "type": {
        this.typedIn.add(tab);
        return d("input", `Typed "${short(String(input.text ?? ""), 36)}"`, here, this.webChange(here, "typed", "maybe"));
      }
      case "key": {
        const keys = String(input.text ?? "");
        if (/^(Return|Enter)$/i.test(keys) && this.typedIn.has(tab)) {
          this.typedIn.delete(tab);
          const verb: CoworkVerb = MESSAGING.test(here?.site ?? "") ? "sent" : "submitted";
          return d("click", "Pressed Enter after typing", here, this.webChange(here, verb, "likely"));
        }
        return d("input", `Pressed ${short(keys, 24)}`);
      }
      case "left_click": case "double_click": case "triple_click": case "right_click": case "left_click_drag": {
        const ref = this.refInfo(tab, input.ref);
        const label = ref ? `${ref.role} "${short(ref.name, 36)}"` : null;
        const what = label ? `Clicked ${label}` : "Clicked on the page";
        if (act === "triple_click") return d("input", label ? `Selected ${label}` : "Selected text");
        if (ref && /^(link|tab|menuitem|option|checkbox|radio|combobox|textbox|searchbox|heading|img|generic)$/i.test(ref.role)) return d("click", what);
        if (ref && COMMIT.test(ref.name)) return d("click", what, here, this.webChange(here, verbForLabel(ref.name, here?.site ?? ""), "likely"));
        return d("click", what, here, this.webChange(here, "clicked", "maybe"));
      }
      default: return d("read", act || "computer");
    }
  }

  /** Local dev apps never count as changes to the world (see docs/cowork.md, open questions). */
  private webChange(place: Place | null, verb: CoworkVerb, confidence: CoworkConfidence): Draft["change"] {
    return place && place.area === "web" ? { verb, confidence } : undefined;
  }

  private refInfo(tab: string, ref: unknown) {
    return typeof ref === "string" ? this.refs.get(`${tab}|${ref}`) ?? this.refs.get(`*|${ref}`) : undefined;
  }
  private refName(tab: string, ref: unknown) {
    const r = this.refInfo(tab, ref);
    return r ? `${r.role} "${short(r.name, 30)}"` : undefined;
  }

  /** After a browser call: remember tab urls/titles and element names the result listed. */
  private absorbResult(text: string) {
    const { executed, tabs } = parseTabContext(text);
    for (const [id, t] of tabs) if (t.url) this.tabs.set(id, t);
    const tab = executed ?? this.lastTab;
    const put = (ref: string, role: string, name: string) => {
      if (!name) return;
      this.refs.set(`${tab}|${ref}`, { role, name });
      this.refs.set(`*|${ref}`, { role, name });
    };
    // In-app pane: `button "Support us" [ref_6]`   Chrome: `ref_24: textbox "Rechercher…"`
    for (let m, re = /(\w+) "([^"\n]*)"[^\[\n]{0,80}\[(ref_\d+)\]/g; (m = re.exec(text)); ) put(m[3], m[1], m[2]);
    for (let m, re = /(ref_\d+): (\w+) "+([^"\n]*)"+/g; (m = re.exec(text)); ) put(m[1], m[2], m[3]);
  }

  // ---- connectors and other MCP servers ----

  private learnTitles(input: Record<string, any>, text: string) {
    const created = input.container?.create?.name ?? input.container?.create?.title ?? input.create?.name;
    if (typeof created !== "string") return;
    for (let m, re = /"(?:id|minted|slug)":"([0-9a-f-]{8,})"/g; (m = re.exec(text)); ) this.itemTitles.set(m[1], short(created, 60));
  }

  private service(server: string, name: string, input: Record<string, any>, failed: boolean, text = ""): Draft[] {
    if (server === "Claude_Code_iOS_Simulator") {
      const act = String(input.action ?? name);
      const place: Place = { area: "apps", site: "iOS Simulator", page: `sim:${input.device ?? input.udid ?? "Simulator"}`, title: String(input.device ?? "Simulator") };
      const action: Draft["action"] = act === "screenshot" || act === "attach" ? "read" : act === "launch" || act === "open_url" ? "visit" : /tap|swipe|touch|button/.test(act) ? "click" : act === "text" ? "input" : "read";
      return [{ tool: act, action, what: act === "text" ? `Typed "${short(String(input.text ?? ""), 36)}"` : act === "launch" ? "Launched the app" : act, place, failed }];
    }
    if (server === "computer-use" || /computer.?use/i.test(server)) {
      const act = String(input.action ?? name);
      const app = str(input.app) ?? str(input.application) ?? "Desktop";
      const place: Place = { area: "apps", site: app, page: `app:${app}` };
      if (/click|drag/.test(act)) return [{ tool: act, action: "click", what: "Clicked", place, change: { verb: "clicked", confidence: "maybe" }, failed }];
      if (/type|key/.test(act)) return [{ tool: act, action: "input", what: `Typed "${short(String(input.text ?? ""), 36)}"`, place, change: { verb: "typed", confidence: "maybe" }, failed }];
      return [{ tool: act, action: "read", what: act, place, failed }];
    }

    const svc = serviceName(server, name);
    this.learnTitles(input, text);
    const raw = serviceItem(input);
    const known = raw ? this.itemTitles.get(raw) ?? (input.container?.id ? this.itemTitles.get(input.container.id) : undefined) : undefined;
    if (raw && known && input.container?.id) this.itemTitles.set(input.container.id, known);
    // Opaque ids ("dc2c64ba-2bb6…") make poor names: show "Doc dc2c64ba" until we learn titles (docs/cowork.md).
    const opaque = (v: string) => /^[0-9a-f]{6,}(-[0-9a-f]+)*$/i.test(v);
    let item = known ?? (raw && opaque(raw) ? `${ITEM_NOUN[svc] ?? "Item"} ${raw.slice(0, 8)}` : raw ?? svc);
    if (input.object === "utterance") item = `Comment on ${known ?? item}`;
    const place: Place = { area: "services", site: svc, page: `${svc}:${raw ?? name}`, title: item };
    const verb = verbForTool(name);
    return [verb
      ? { tool: name, action: "write", what: `${capital(verb)} ${short(item, 40)}`, place, change: { verb, confidence: "sure" }, failed }
      : { tool: name, action: /search|query/.test(name) ? "search" : "read", what: `${capital(name.replace(/_/g, " "))}`, place, failed }];
  }

  // ---- built-in tools: web, artifacts, outward shell commands ----

  private builtin(tool: string, input: Record<string, any>, text: string, failed: boolean): Draft[] {
    if (tool === "WebFetch") {
      const place = placeForUrl(str(input.url));
      return [{ tool, action: "read", what: input.prompt ? `Fetched: ${short(String(input.prompt), 60)}` : "Fetched the page", place, failed }];
    }
    if (tool === "WebSearch") {
      const q = short(String(input.query ?? ""), 80);
      return [{ tool, action: "search", what: `Searched "${q}"`, place: { area: "web", site: "Web search", page: `search:${q.toLowerCase()}`, title: q }, failed }];
    }
    if (tool === "Artifact") {
      const act = String(input.action ?? "publish");
      const item = str(input.url) ?? str(input.file_path)?.split("/").pop() ?? str(input.title) ?? "artifact";
      const place: Place = { area: "services", site: "Artifacts", page: `artifact:${item}`, title: item };
      if (act === "publish") return [{ tool, action: "write", what: `Published ${short(item, 40)}`, place, change: { verb: input.url ? "updated" : "published", confidence: "sure" }, failed }];
      if (act === "delete") return [{ tool, action: "write", what: `Deleted ${short(item, 40)}`, place, change: { verb: "deleted", confidence: "sure" }, failed }];
      return [{ tool, action: "read", what: capital(act), place, failed }];
    }
    if (tool === "ArtifactData") {
      const act = String(input.action ?? "");
      const place: Place = { area: "services", site: "Artifacts", page: `artifact:${str(input.url) ?? "data"}`, title: str(input.url) };
      return /set|update|delete|batch/.test(act)
        ? [{ tool, action: "write", what: `Changed shared data (${act})`, place, change: { verb: act === "delete" ? "deleted" : "updated", confidence: "sure" }, failed }]
        : [{ tool, action: "read", what: "Read shared data", place, failed }];
    }
    if (tool === "Bash") return shellEvents(String(input.command ?? ""), text, failed);
    return [];
  }
}

const ITEM_NOUN: Record<string, string> = { Docs: "Doc", Calendar: "Event", Email: "Thread", "Scheduled tasks": "Task" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Connectors often have opaque ids for server names; guess a readable name from the tool names. */
function serviceName(server: string, tool: string): string {
  if (server === "scheduled-tasks") return "Scheduled tasks";
  if (/event|calendar|suggest_time/.test(tool)) return "Calendar";
  if (/mail|message|draft|thread|label|inbox/.test(tool)) return "Email";
  if (/^(batch|guide|export|query|create|read|update|delete)$/.test(tool) && /^[0-9a-f-]{36}$/.test(server)) return "Docs";
  if (/^[0-9a-f-]{36}$/.test(server)) return `Connector ${server.slice(0, 4)}`;
  return server.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function serviceItem(input: Record<string, any>): string | undefined {
  const c = input.container ?? {};
  const v = input.title ?? input.summary ?? input.subject ?? input.name ?? c.create?.title ?? c.create?.name ?? input.ref?.id ?? c.id ?? input.eventId ?? input.event_id ?? input.taskId ?? input.id;
  return typeof v === "string" && v.trim() ? short(v, 60) : undefined;
}

function verbForTool(name: string): CoworkVerb | undefined {
  if (/^(create|add|insert|new|schedule)/.test(name)) return "created";
  if (/^(delete|remove|archive|trash)/.test(name)) return "deleted";
  if (/^(send|reply|forward)/.test(name)) return "sent";
  if (/^(publish|post|share)/.test(name)) return "published";
  if (/^(update|edit|patch|set|move|rename|respond|batch|run)/.test(name)) return "updated";
  return undefined;
}

/** Split a shell command into simple commands (argv lists). Drops heredoc bodies; quotes are handled loosely. */
export function simpleCommands(cmd: string): string[][] {
  const noHeredocs = cmd.replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, "");
  return noHeredocs.split(/\n|;|&&|\|\||\||\$\(|`/).map((part) => {
    const argv = part.trim().split(/\s+/).filter(Boolean).map((a) => a.replace(/^["']|["']$/g, ""));
    while (argv.length && (/^\w+=/.test(argv[0]) || /^(sudo|npx|time|exec|command|env|\(|\{)$/.test(argv[0]))) argv.shift();
    return argv;
  }).filter((a) => a.length);
}

const cleanRef = (r: string) => r.replace(/^\+/, "").split(":").pop()!.replace(/^refs\/heads\//, "");

/** Shell commands that reach outside the machine: pushes, deploys, cloud CLIs, HTTP calls. Only the program at the start of each command counts. */
export function shellEvents(cmd: string, result: string, resultFailed: boolean): Draft[] {
  const out: Draft[] = [];
  // For outward commands, an error line in the output is a failure even when the exit code was swallowed by a pipe.
  const failed = resultFailed || /(^|\n)\s*(error|fatal|! \[rejected\])\b|\bnot found\b/i.test(result.slice(0, 600));
  const svc = (site: string, page: string, action: Draft["action"], what: string, verb?: CoworkVerb): Draft =>
    ({ tool: "Bash", action, what, place: { area: "services", site, page: `${site}:${page}`, title: page }, change: verb && !failed ? { verb, confidence: "sure" } : undefined, failed });

  for (const argv of simpleCommands(cmd)) {
    const [prog, sub = "", ...rest] = argv;
    const args = rest.filter((a) => !a.startsWith("-"));
    if (prog === "git" && sub === "push") {
      const ref = args[1] ? cleanRef(args[1]) : null;
      const noop = /Everything up-to-date/.test(result);
      out.push(svc("GitHub", ref ? `branch ${ref}` : "current branch", noop ? "read" : "write", noop ? "Push: already up to date" : `Pushed ${ref ? `branch ${ref}` : "commits"}`, noop ? undefined : "pushed"));
    } else if (prog === "gh" && /^(pr|issue|release|repo|run|workflow)$/.test(sub)) {
      const act = rest[0] ?? "";
      const verb: CoworkVerb | undefined = /^(create|new|fork)$/.test(act) ? "created" : act === "delete" ? "deleted" : /^(merge|close|edit|comment|review|reopen|ready|rerun|enable|disable)$/.test(act) ? "updated" : undefined;
      out.push(svc("GitHub", `${sub}s`, verb ? "write" : "read", `gh ${sub} ${act}`.trim(), verb));
    } else if (prog === "gh" && sub === "api") {
      const writes = /-X\s*(POST|PUT|PATCH|DELETE)|--method\s+(POST|PUT|PATCH|DELETE)|\s-[fF]\s/i.test(argv.join(" "));
      out.push(svc("GitHub", "api", writes ? "write" : "read", "gh api", writes ? "updated" : undefined));
    } else if (prog === "vercel") {
      if (/^(--version|-v|--help|-h|help)$/.test(sub)) continue;
      const deploys = !sub || sub.startsWith("-") || sub === "deploy";
      const prod = argv.includes("--prod");
      // The alias ("brainstorm-landing.vercel.app") names the site better than the hashed deployment url.
      const alias = /Aliased[^\n]*?https?:\/\/([^\s"',]+)/.exec(result)?.[1] ?? /Production: https?:\/\/([^\s"',]+)/.exec(result)?.[1];
      if (deploys) out.push(svc("Vercel", alias ?? (prod ? "production" : "previews"), "write", prod ? `Deployed to production${alias ? ` (${alias})` : ""}` : "Deployed a preview", "deployed"));
      else if (sub === "alias" && (rest[0] === "set" || args.length >= 2)) out.push(svc("Vercel", "domains", "write", "Pointed a domain", "updated"));
      else if ((sub === "remove" || sub === "rm")) out.push(svc("Vercel", "deployments", "write", "Removed a deployment", "deleted"));
      else if (sub === "env" && /^(add|rm|remove)$/.test(rest[0] ?? "")) out.push(svc("Vercel", "settings", "write", `vercel env ${rest[0]}`, "updated"));
      else if (sub === "project" && /^(add|rm|remove)$/.test(rest[0] ?? "")) out.push(svc("Vercel", "projects", "write", `vercel project ${rest[0]}`, rest[0] === "add" ? "created" : "deleted"));
      else if (sub !== "--version" && sub !== "help") out.push(svc("Vercel", "account", "read", `vercel ${sub}`));
    } else if (prog === "brev" && sub && !sub.startsWith("-")) {
      const name = args[0] ?? "instances";
      const verb: CoworkVerb | undefined = sub === "create" ? "created" : sub === "delete" ? "deleted" : /^(start|stop|reset|scale)$/.test(sub) ? "updated" : undefined;
      out.push(svc("Brev", /^(ls|login|org)$/.test(sub) ? "instances" : name, verb ? "write" : "read", `brev ${sub}${/^(ls|login|org)$/.test(sub) ? "" : ` ${name}`}`, verb));
    } else if (prog === "npm" && sub === "publish") {
      out.push(svc("npm", "packages", "write", "Published a package", "published"));
    } else if (prog === "curl") {
      const line = argv.join(" ");
      const place = placeForUrl(/https?:\/\/[^\s"'`)]+/.exec(line)?.[0]);
      if (!place) continue;
      const sends = /-X\s*(POST|PUT|PATCH|DELETE)|\s(-d|--data\S*|-F|--form)(\s|$)/i.test(line);
      out.push({ tool: "curl", action: sends ? "write" : "read", what: sends ? "Sent a request" : "Fetched with curl", place,
        change: sends && place.area === "web" && !failed ? { verb: /DELETE/i.test(line) ? "deleted" : "sent", confidence: "likely" } : undefined, failed });
    }
  }
  return out;
}
