// The parts the thread's three lists share: the Track (ReplaySteps), the folded sidebar's card (sidebar/NowCard) and
// Places' list (cowork/PlaceSteps). One row (MomentRow), which rows to draw (useRowWindow), and the list and the
// cursor moving each other (useCursorScroll): scrolling the list moves the thread to the row at its middle, and the
// thread moving brings its row to the middle, unless you scrolled just now.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

type RowProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  /** A button (a row you pick), or a span (a row inside one, as on the folded card). */
  as?: "button" | "span";
  /** What stands before the words: the dot (default), or a subagent's initial. */
  mark?: ReactNode;
  label: ReactNode;
  failed?: boolean;
  /** Quiet words at the right (Places: where). */
  aside?: ReactNode;
  [data: `data-${string}`]: string | number | undefined;
};

/** One moment: its dot, its words, "failed" when something did, and what is at its right. Its classes say its tone and
 *  state (`rp-m edit current`, `sn-m fl done d2`...). */
export function MomentRow({ as = "button", mark, label, failed, aside, ...rest }: RowProps) {
  const inner = <>{mark ?? <b aria-hidden="true" />}<span>{label}</span>{failed && <em>failed</em>}{aside}</>;
  return as === "span" ? <span {...rest}>{inner}</span> : <button {...rest}>{inner}</button>;
}

export type Range = [number, number]; // rows [start, end)

/** `size` rows about `at` (`before` of them above it), kept `size` long at the ends of [from, end). */
function around(at: number, before: number, size: number, from: number, end: number): Range {
  const start = Math.max(from, Math.min(at - before, end - size));
  return [start, Math.min(end, start + size)];
}

/**
 * Which of the rows [from, end) to draw: `size` rows about the cursor (`before` above it), and with `view`, the rows in
 * view in the scrolling list too (`overscan` rows past each edge; every row `rowH` tall, `box` where the rows start).
 * The ranges come back merged and in order; what isn't drawn the caller stands in for (a spacer).
 * The folded card draws its four rows this way; the Track's open chapter, the rows you see and those around the cursor.
 */
export function useRowWindow({ from = 0, end, at, before, size, view }: {
  from?: number; end: number; at: number; before: number; size: number;
  view?: { box: RefObject<HTMLElement | null>; scroller: string; rowH: number; overscan: number };
}): Range[] {
  const clamp = (r: Range): Range => [Math.max(from, r[0]), Math.min(end, r[1])];
  const rowH = view?.rowH ?? 1, overscan = view?.overscan ?? 0, box = view?.box, scroller = view?.scroller ?? "";
  // The rows in view, from where the rows sit in the list's scroll.
  const inView = useCallback((): Range | null => {
    const el = box?.current, list = el?.closest(scroller);
    if (!el || !list) return null;
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    return [from + Math.floor(-top / rowH), from + Math.ceil((list.clientHeight - top) / rowH)];
  }, [from, rowH, box, scroller]);
  const [seen, setSeen] = useState<Range>(() => [at - overscan, at + overscan]);
  // Follow the list's scroll: draw again only once the view nears the edge of what is drawn.
  useLayoutEffect(() => {
    if (!view) return;
    const list = box?.current?.closest(scroller);
    if (!list) return;
    const update = () => {
      const v = inView();
      if (v) setSeen((cur) => (v[0] - overscan / 2 < cur[0] && cur[0] > from) || (v[1] + overscan / 2 > cur[1] && cur[1] < end) || v[1] < cur[0] || v[0] > cur[1]
        ? [v[0] - overscan, v[1] + overscan] : cur);
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    return () => list.removeEventListener("scroll", update);
  }, [inView, from, end, !!view, overscan]);

  const ranges: Range[] = view ? [clamp(seen)] : [];
  if (at >= from && at < end) ranges.push(around(at, before, size, from, end));
  ranges.sort((p, q) => p[0] - q[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    if (r[1] <= r[0]) continue;
    const m = merged[merged.length - 1];
    if (m && r[0] <= m[1]) m[1] = Math.max(m[1], r[1]); else merged.push([r[0], r[1]]);
  }
  return merged;
}

const USER_MS = 400;   // the list stops following the cursor this long after you scroll it
const OWN_MS = 700;    // "any" lists: a scroll this soon after the list glided by itself is still that glide

type CursorScroll<T extends HTMLElement> = {
  /** The row the thread is at, and how many rows there are. */
  at: number; count: number;
  /** Move the thread to a row (from a scroll you made). */
  go: (i: number) => void;
  /** The row at the list's middle line (the list's own ends included); NaN or below 0 when there is none. */
  rowAtCenter: (list: T) => number;
  /** Where the thread's row is in the list (offsetTop and height), or null when it can't be found. */
  cursorBox: (list: T) => { top: number; height: number } | null;
  /** Jump instead of gliding (a first scroll, a long way). */
  instant?: (delta: number, first: boolean) => boolean;
  /** "input": only wheel, touch, keys and the scroll bar are you (the Track); "any": every scroll but the list's own glide. */
  user: "input" | "any";
  /** What else brings the thread's row back to the middle when it changes. */
  deps: unknown[];
  /** Another thread: the next scroll jumps again. */
  resetKey?: unknown;
};

/** The list and the thread's cursor moving each other. Spread the handlers on the list, and `ref` it. */
export function useCursorScroll<T extends HTMLElement>(o: CursorScroll<T>) {
  const ref = useRef<T>(null);
  const userAt = useRef(0);
  const ownAt = useRef(0);   // when the list last scrolled itself to the cursor
  const dragging = useRef(false);
  const raf = useRef(0);
  const first = useRef(true);
  const opts = useRef(o); opts.current = o;

  const markUser = useCallback(() => { userAt.current = performance.now(); }, []);
  const release = useCallback(() => { userAt.current = 0; }, []);
  useEffect(() => {
    const up = () => { if (dragging.current) { dragging.current = false; markUser(); } };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [markUser]);

  // The list's scroll moves the cursor to the row at its middle.
  const onScroll = useCallback(() => {
    if (opts.current.user === "input") {
      // Our own scroll (following the cursor) or a layout shift: only a scroll you started counts, and one you started
      // before the list last moved by itself doesn't (a trackpad's glide would otherwise pick a row mid-way and flip a
      // live thread back and forth).
      if (!dragging.current && (performance.now() - userAt.current > USER_MS || userAt.current < ownAt.current)) return;
    } else {
      // Its own glide to the thread's row isn't you: only a scroll that starts away from one counts (a wheel's coast too).
      if (performance.now() - ownAt.current < OWN_MS) return;
      userAt.current = performance.now();
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const i = opts.current.rowAtCenter(el);
      if (Number.isFinite(i) && i >= 0 && i !== opts.current.at) opts.current.go(i);
    });
  }, []);

  // The cursor scrolls the list, unless you scrolled it just now.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !o.count) return;
    if (dragging.current || performance.now() - userAt.current < USER_MS) return;
    const box = opts.current.cursorBox(el);
    if (!box) return;
    const top = Math.max(0, box.top - el.clientHeight / 2 + box.height / 2);
    const delta = Math.abs(el.scrollTop - top);
    if (delta < 2) return;
    ownAt.current = performance.now();
    el.scrollTo({ top, behavior: opts.current.instant?.(delta, first.current) ? "auto" : "smooth" });
    first.current = false;
  }, [o.at, o.count, ...o.deps]);
  useEffect(() => { first.current = true; }, [o.resetKey]);

  const input = o.user === "input";
  return {
    ref,
    /** Follow the cursor again now (a row picked), even if you scrolled just now. */
    release,
    onScroll,
    onWheel: input ? markUser : undefined,
    onTouchMove: input ? markUser : undefined,
    onKeyDown: input ? (e: KeyboardEvent) => { if (["PageUp", "PageDown", "ArrowUp", "ArrowDown"].includes(e.key)) markUser(); } : undefined,
    onPointerDown: input ? (e: PointerEvent) => { if (e.target === e.currentTarget) { dragging.current = true; markUser(); } } : undefined,
  };
}
