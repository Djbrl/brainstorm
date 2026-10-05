// Owner: C (words and numbers). What counts as a thread, the same in the workspace picker and the sidebar.
// A thread is one Claude Code session: a `<sessionId>.jsonl` transcript at the top of one of the repo's Claude Code
// project folders (its main checkout, its worktrees, folders it lived in before it moved), counted once per id.
// Not threads: subagent transcripts (`<session>/subagents/*.jsonl`, part of their session), a session whose
// transcript is gone (deleted in Claude Code, or cleaned up), and a session where nothing happened but a slash
// command (opening this app, /compact): no tool used and no message typed. The sidebar applies the same rules to
// what it read (ListenerService.listSessions).
import { closeSync, openSync, readSync } from "node:fs";
import { promptTitle } from "../listener/listener.service";

/** Transcripts this big always hold work or talk; only small ones are read to check. */
const IDLE_MAX_BYTES = 256 * 1024;

const seen = new Map<string, { size: number; idle: boolean }>(); // transcripts only grow: re-read one when its size changes

/** True if a transcript holds nothing but slash commands: no tool call, and no message the person typed. */
export function isIdleTranscript(path: string, size: number): boolean {
  if (size > IDLE_MAX_BYTES) return false;
  const hit = seen.get(path);
  if (hit?.size === size) return hit.idle;
  const idle = readIdle(path, size);
  seen.set(path, { size, idle });
  return idle;
}

function readIdle(path: string, size: number): boolean {
  let fd: number | undefined;
  let text: string;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(size);
    const n = readSync(fd, buf, 0, size, 0);
    text = buf.toString("utf8", 0, n);
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
  if (text.includes('"type":"tool_use"')) return false;
  let title: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === "custom-title" && typeof o.customTitle === "string") { title = o.customTitle; break; }
    if (title || o?.type !== "user" || o.isCompactSummary) continue;
    const c = o.message?.content;
    const raw = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n\n") : "";
    if (raw.trim()) title = promptTitle(raw);
  }
  return !title || title.startsWith("/");
}
