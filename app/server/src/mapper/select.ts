// Which files go on the map when a project has more than the cap. Deliberate, not walk order:
//  - every top-level folder shows up, and every module ("packages/web") gets a fair share, so nothing silently vanishes;
//  - within that, the files that matter most win: ones agents touched, recently changed ones, and central ones
//    (imported by many) and bigger ones.
import { moduleOf } from "./ignore";

const topOf = (rel: string) => { const i = rel.search(/[\\/]/); return i === -1 ? "." : rel.slice(0, i); };
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Half the cap is shared out evenly between modules; the rest goes to the best files anywhere. */
const SPREAD_SHARE = 0.5;

/**
 * Pick `cap` of `rels` (all of them when they fit, in the order given). `score`: higher is more worth showing.
 * 1. the best file of every top-level folder; 2. an even share per module (its best files); 3. the best files left.
 */
export function selectFiles(rels: string[], cap: number, score: (rel: string) => number = () => 0): string[] {
  if (rels.length <= cap) return rels;
  const s = new Map(rels.map((r) => [r, score(r)]));
  const best = (a: string, b: string) => s.get(b)! - s.get(a)! || byPath(a, b);
  const taken = new Set<string>();
  const take = (rel: string) => { if (taken.size < cap) taken.add(rel); };

  // 1. every top-level folder, by its best file
  const tops = new Map<string, string>();
  for (const rel of rels) { const t = topOf(rel), cur = tops.get(t); if (!cur || best(rel, cur) < 0) tops.set(t, rel); }
  [...tops.values()].sort(best).forEach(take);

  // 2. a fair share for every module (or one file each for the best modules, when there are more modules than the share)
  const modules = new Map<string, string[]>();
  for (const rel of rels) { const m = moduleOf(rel); const l = modules.get(m); if (l) l.push(rel); else modules.set(m, [rel]); }
  const lists = [...modules.values()].map((l) => l.sort(best)).sort((a, b) => best(a[0], b[0]));
  const share = Math.floor(cap * SPREAD_SHARE);
  const quota = Math.max(1, Math.floor(share / lists.length));
  let spent = 0;
  for (const l of lists) {
    let n = 0;
    for (const rel of l) {
      if (n >= quota || spent >= share || taken.size >= cap) break;
      if (!taken.has(rel)) { take(rel); spent++; }
      n++;
    }
  }

  // 3. the best of the rest
  if (taken.size < cap) for (const rel of [...rels].sort(best)) { if (taken.size >= cap) break; take(rel); }
  return rels.filter((r) => taken.has(r));
}

/** Rescale values to 0..1 by rank (robust to outliers); missing or zero values score 0. */
export function rankScale(values: Map<string, number>): Map<string, number> {
  const positive = [...values].filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1]);
  const out = new Map<string, number>();
  positive.forEach(([k], i) => out.set(k, positive.length === 1 ? 1 : i / (positive.length - 1)));
  return out;
}

export type Signals = {
  /** When each file last changed, in seconds (a commit, a modification, an agent's step). */
  changedAt?: Map<string, number>;
  /** Files an agent touched in this project's threads. */
  touched?: Set<string>;
  /** How many mapped files import each file. */
  importedBy?: Map<string, number>;
  /** Lines per file. */
  lines?: Map<string, number>;
};

/** One score from the signals: touched by an agent 2, recency 1, imported by many 1, size 0.5 (each rank-scaled). */
export function scoreFrom(sig: Signals): (rel: string) => number {
  const recency = rankScale(sig.changedAt ?? new Map());
  const central = rankScale(sig.importedBy ?? new Map());
  const size = rankScale(sig.lines ?? new Map());
  return (rel) => (sig.touched?.has(rel) ? 2 : 0) + (recency.get(rel) ?? 0) + (central.get(rel) ?? 0) + 0.5 * (size.get(rel) ?? 0);
}
