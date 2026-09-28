import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "../core/local";

// Owned by the lead. Removes everything unrelated to the project from a replay before it is published: titles of the
// user's other Claude threads, other project names and folders, private files, personal emails. The list lives in
// server/data/redact.json, which is gitignored on purpose (committing it would publish the very names it hides).
type RedactList = {
  threadTitles?: string[];        // replaced by "[other thread]"
  projects?: string[];            // replaced by "[other project]"
  regexes?: [string, string][];   // [pattern, replacement]
  privateTerms?: string[];        // any string value containing one is replaced entirely
  dropStepTextMatching?: string[];// step texts matching one (multiline) are replaced entirely
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REMOVED = "[removed: private content]";

/** Redacts every string value (not the serialized JSON, so line starts and word boundaries behave). */
export function redactReplayJson(json: string): { json: string; count: number } {
  const file = resolve(dataDir(), "redact.json");
  if (!existsSync(file)) return { json, count: 0 };
  const list = JSON.parse(readFileSync(file, "utf8")) as RedactList;
  let count = 0;
  const rules: [RegExp, string][] = [
    // Longest first, so a full title wins over a project name inside it. Word boundaries keep "woke" out of "awoke".
    ...[...(list.threadTitles ?? [])].sort((a, b) => b.length - a.length).map((t): [RegExp, string] => [new RegExp(`(?<![\\w])${esc(t)}(?![\\w])`, "g"), "[other thread]"]),
    ...[...(list.projects ?? [])].sort((a, b) => b.length - a.length).map((p): [RegExp, string] => [new RegExp(`(?<![\\w])${esc(p)}(?![\\w])`, "g"), "[other project]"]),
    ...(list.regexes ?? []).map(([re, to]): [RegExp, string] => [new RegExp(re, "g"), to]),
  ];
  const privateTerms = list.privateTerms ?? [];
  const drops = (list.dropStepTextMatching ?? []).map((re) => new RegExp(re, "m"));

  const str = (s: string): string => {
    if (privateTerms.some((t) => s.includes(t)) || drops.some((re) => re.test(s))) { count++; return REMOVED; }
    for (const [re, to] of rules) s = s.replace(re, () => { count++; return to; });
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return str(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { json: JSON.stringify(walk(JSON.parse(json))), count };
}
