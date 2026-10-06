// Owner: A. The changed parts of a file, as the step views show an edit: each hunk's lines before and after (with a
// little context), hunks joined by "\n---\n" like a MultiEdit. Used for files a command changed (command-edits.ts),
// where only the whole file before and after is known.

const CONTEXT = 2;
/** Past this many lines either side, or this many changed lines, one hunk from the first change to the last. */
const MAX_LINES = 20_000;
const MAX_D = 1_000;

/** Myers' diff on lines: for each line of `a` and `b`, whether it's kept. Null when the files are too big or too different. */
function keptLines(a: string[], b: string[]): { keepA: boolean[]; keepB: boolean[] } | null {
  const n = a.length, m = b.length, max = Math.min(n + m, MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return null;
  const keepA = new Array<boolean>(n).fill(false), keepB = new Array<boolean>(m).fill(false);
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d], k = x - y;
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1;
    const px = vd[off + prevK], py = px - prevK;
    while (x > px && y > py) { x--; y--; keepA[x] = true; keepB[y] = true; }
    x = px; y = py;
  }
  while (x > 0 && y > 0) { x--; y--; keepA[x] = true; keepB[y] = true; }
  return { keepA, keepB };
}

/** The changed parts of `before` → `after`: per hunk, its lines before and after; empty when nothing changed. */
export function lineHunks(before: string, after: string): { before: string; after: string } {
  if (before === after) return { before: "", after: "" };
  if (!before) return { before: "", after };   // a new file: all of it
  if (!after) return { before, after: "" };    // emptied or deleted
  const a = before.split("\n"), b = after.split("\n");
  // Lines the same at both ends are never part of a hunk (also keeps the diff small).
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const midA = a.slice(pre, a.length - suf), midB = b.slice(pre, b.length - suf);
  const kept = midA.length + midB.length <= MAX_LINES ? keptLines(midA, midB) : null;
  // Changed line ranges, as [startA, endA, startB, endB) in the whole files.
  const ranges: [number, number, number, number][] = [];
  if (!kept) ranges.push([pre, a.length - suf, pre, b.length - suf]);
  else {
    let i = 0, j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && kept.keepA[i] && kept.keepB[j]) { i++; j++; continue; }
      const si = i, sj = j;
      while (i < midA.length && !kept.keepA[i]) i++;
      while (j < midB.length && !kept.keepB[j]) j++;
      ranges.push([pre + si, pre + i, pre + sj, pre + j]);
    }
  }
  // With context, merging ranges whose context would touch.
  const hunks: [number, number, number, number][] = [];
  for (const [sa, ea, sb, eb] of ranges) {
    const h: [number, number, number, number] = [Math.max(0, sa - CONTEXT), Math.min(a.length, ea + CONTEXT), Math.max(0, sb - CONTEXT), Math.min(b.length, eb + CONTEXT)];
    const last = hunks[hunks.length - 1];
    if (last && h[0] <= last[1]) { last[1] = h[1]; last[3] = h[3]; } else hunks.push(h);
  }
  return {
    before: hunks.map(([sa, ea]) => a.slice(sa, ea).join("\n")).join("\n---\n"),
    after: hunks.map(([, , sb, eb]) => b.slice(sb, eb).join("\n")).join("\n---\n"),
  };
}
