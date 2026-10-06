// Hook: tell the running Rundown that Claude Code is waiting on the user (a permission prompt, a question, the end
// of a turn) or has moved on (a new prompt). Runs in the background (async hook): silent, never blocks, always exits 0.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DATA = process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".brainstorm");

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const h = JSON.parse(input || "{}");
  const { port } = JSON.parse(readFileSync(join(DATA, "server.json"), "utf8"));
  if (!port || !h.session_id) return;
  // Only what Rundown needs: no transcript path or working directory.
  const body = {
    event: h.hook_event_name, session_id: h.session_id,
    notification_type: h.notification_type, message: h.message,
    tool_name: h.tool_name, tool_input: h.tool_input, tool_use_id: h.tool_use_id,
  };
  await fetch(`http://127.0.0.1:${port}/api/hooks`, {
    method: "POST", headers: { "content-type": "application/json", "x-brainstorm-hook": "1" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(1500),
  });
}
main().catch(() => {}).finally(() => process.exit(0));
