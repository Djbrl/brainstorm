// Owned by the lead. Tool calls and shell commands in words, for the web (Follow, the map's step list) and the
// server (Track) alike: "Stop the preview", not "preview stop". Used until (or instead of) a model-written label.

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A shell command in a few words: its first line, or what kind of script a heredoc runs. */
export function commandLabel(cmd: string): string {
  const c = cmd.trim().replace(/^cd\s+\S+\s*(&&|;)\s*/, "");
  const script = /^(python3?|node|npx tsx|bun|ruby|bash|sh|zsh)\b[^\n]*<</.exec(c)?.[1];
  if (script) return `Run a ${{ python: "Python", python3: "Python", node: "Node", "npx tsx": "TypeScript", bun: "Bun", ruby: "Ruby" }[script] ?? "shell"} script`;
  const line = c.split("\n")[0].trim();
  return line ? `Run ${line.length > 70 ? `${line.slice(0, 69).trimEnd()}…` : line}` : "Run a command";
}

const host = (u: string) => { try { return new URL(u).host || u; } catch { return u; } };

// Tools from MCP servers and Claude Code's desktop app, in words (keyed by the tool's own name, server prefix dropped).
const TOOL_WORDS: Record<string, string | ((i: Record<string, unknown>) => string)> = {
  browser_batch: (i) => (Array.isArray(i.actions) ? `Use the browser (${i.actions.length} ${i.actions.length === 1 ? "step" : "steps"})` : "Use the browser"),
  javascript_tool: "Run a script in the page",
  computer: (i) => ({ screenshot: "Take a screenshot", left_click: "Click in the page", double_click: "Click in the page", right_click: "Click in the page",
    type: "Type in the page", key: "Press a key", scroll: "Scroll the page", scroll_to: "Scroll the page", zoom: "Zoom in on the page", wait: "Wait for the page", hover: "Hover in the page" } as Record<string, string>)[str(i.action)] ?? "Use the browser",
  navigate: (i) => (str(i.url) ? `Open ${host(str(i.url))}` : "Open a page"),
  find: (i) => (str(i.query) ? `Find “${str(i.query).slice(0, 50)}” on the page` : "Find on the page"),
  read_page: "Read the page", get_page_text: "Read the page",
  form_input: "Fill in a form field",
  resize_window: "Resize the browser",
  preview_start: "Start the preview", preview_stop: "Stop the preview", preview_list: "List the previews", preview_logs: "Read the preview's logs",
  read_console_messages: "Read the browser console", read_network_requests: "Read network requests",
  tabs_create: "Open a tab", tabs_close: "Close a tab", tabs_select: "Switch tabs", tabs_context: "List the browser's tabs",
  create_event: "Create a calendar event", update_event: "Update a calendar event", delete_event: "Delete a calendar event", list_events: "Check the calendar", search_events: "Search the calendar",
  SendMessage: "Message another agent", SubagentHandback: "Hand back to the lead agent", ListAgents: "Check the other agents",
  Artifact: "Publish a page", SendUserFile: "Send you a file", AskUserQuestion: "Ask you a question",
  Skill: (i) => (str(i.skill) ? `Use the ${str(i.skill)} skill` : "Use a skill"),
  TaskStop: "Stop a background task", KillShell: "Stop a background task", BashOutput: "Check a background command",
  NotebookEdit: "Edit a notebook", ExitPlanMode: "Share the plan", EnterPlanMode: "Start planning",
  mark_chapter: "Start a new chapter", spawn_task: "Suggest a side task", show_widget: "Draw a visual", read_me: "Read the drawing guide",
};

/** A tool call in words: a known tool's phrase, else its name as a sentence ("list sessions" → "List sessions"). */
export function toolLabel(tool: string, input: Record<string, unknown>): string {
  const name = tool.replace(/^mcp__.+?__/, "").replace(/_mcp$/, "");
  const w = TOOL_WORDS[name];
  if (w) return typeof w === "string" ? w : w(input);
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "Use a tool";
}
