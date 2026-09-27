import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Owned by the lead. Removes everything unrelated to the project from a replay before it is published: titles of the
// user's other Claude threads, other project names and folders, personal emails. The list lives in server/data/redact.json,
// which is gitignored on purpose (committing it would publish the very names it hides).
type RedactList = { threadTitles?: string[]; projects?: string[]; regexes?: [string, string][]; dropStepTextMatching?: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redactReplayJson(json: string): { json: string; count: number } {
  const file = resolve(__dirname, "../../data/redact.json");
  if (!existsSync(file)) return { json, count: 0 };
  const list = JSON.parse(readFileSync(file, "utf8")) as RedactList;
  let count = 0;
  // Whole step outputs that show private places (e.g. a listing of the home or Documents folder) are replaced outright.
  const drops = (list.dropStepTextMatching ?? []).map((re) => new RegExp(re, "m"));
  if (drops.length) {
    const data = JSON.parse(json) as { steps?: { text?: string }[] };
    for (const st of data.steps ?? []) {
      if (st.text && drops.some((re) => re.test(st.text!))) { st.text = "[listing of a private folder outside the project, removed]"; count++; }
    }
    json = JSON.stringify(data);
  }
  const sub = (re: RegExp, to: string) => { json = json.replace(re, () => { count++; return to; }); };
  // Longest first, so a full title wins over a project name inside it. Word boundaries keep "woke" out of "awoke".
  for (const t of [...(list.threadTitles ?? [])].sort((a, b) => b.length - a.length)) sub(new RegExp(`(?<![\\w])${esc(t)}(?![\\w])`, "g"), "[other thread]");
  for (const p of [...(list.projects ?? [])].sort((a, b) => b.length - a.length)) sub(new RegExp(`(?<![\\w])${esc(p)}(?![\\w])`, "g"), "[other project]");
  for (const [re, to] of list.regexes ?? []) sub(new RegExp(re, "g"), to);
  JSON.parse(json); // must still be valid
  return { json, count };
}
