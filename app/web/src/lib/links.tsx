// Web addresses in text: found, shortened in the middle for display ("docs.google.com/forms/d/e/…/viewform"), the
// whole address in link colour and on hover. A link opens in a new tab and tells the site nothing about the app
// (rel="noreferrer noopener"); only http and https addresses become links.
import type { ReactNode } from "react";
import "./links.css";

/** An http(s) address in running text. Trailing punctuation and an unmatched ")" are left out (see `trimUrl`). */
export const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

/** "https://a.com/x)." in "(see https://a.com/x)." → "https://a.com/x". */
export function trimUrl(raw: string): string {
  let u = raw.replace(/[.,;:!?*_]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1).replace(/[.,;:!?]+$/, "");
  while (/[\]}>]$/.test(u)) u = u.slice(0, -1);
  return u;
}

/** Keep the start and the end of a path, cut at a "/" or "-" when one is near: "/forms/d/e/…/viewform". */
function middle(path: string, room: number): string {
  if (path.length <= room) return path;
  const keepHead = Math.max(1, Math.ceil((room - 1) * 0.55)), keepTail = Math.max(1, room - 1 - keepHead);
  let head = path.slice(0, keepHead);
  const hs = Math.max(head.lastIndexOf("/"), head.lastIndexOf("-"));
  if (hs > 0 && hs >= keepHead - 10) head = head.slice(0, hs + 1);
  let tail = path.slice(path.length - keepTail);
  const ts = tail.search(/[/-]/);
  if (ts > 0 && ts <= Math.min(10, keepTail - 6)) tail = tail.slice(ts); // keep a few characters of the end
  return `${head}…${tail}`;
}

const seen = new Map<string, { host: string; path: string }>();

/** An address for display: host (no "www.") and its path shortened to fit `max` characters; the query only when there's no path. */
export function shortUrl(url: string, max = 46): { host: string; path: string } {
  const key = `${max} ${url}`;
  const hit = seen.get(key);
  if (hit) return hit;
  let out: { host: string; path: string };
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    try { path = decodeURI(path); } catch { /* keep it encoded */ }
    if (!path && u.search) path = u.search;
    out = { host, path: middle(path, Math.max(12, max - host.length)) };
  } catch {
    out = { host: url.length > max ? `${url.slice(0, max - 1)}…` : url, path: "" };
  }
  if (seen.size > 2000) seen.clear();
  seen.set(key, out);
  return out;
}

/** A link to `url`, shown shortened; the whole address on hover. */
export function UrlLink({ url, max, className = "" }: { url: string; max?: number; className?: string }) {
  const { host, path } = shortUrl(url, max);
  return (
    <a className={`url-link ${className}`} href={url} target="_blank" rel="noreferrer noopener" title={url}>
      <span className="url-host">{host}</span>{path && <span className="url-path">{path}</span>}
    </a>
  );
}

/** The same address as a piece of a label that isn't itself a link (a row you click, a breadcrumb). */
function UrlPiece({ url, max }: { url: string; max?: number }) {
  const { host, path } = shortUrl(url, max);
  return <span className="url-piece" title={url}>{host}{path}</span>;
}

/** Text with each address made a link (`links`) or a link-coloured piece; other text as it is. */
export function withUrls(text: string, opts: { links?: boolean; max?: number; key?: string } = {}): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  URL_RE.lastIndex = 0;
  for (let m; (m = URL_RE.exec(text)); ) {
    const url = trimUrl(m[0]);
    if (url.length < 12) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${opts.key ?? "u"}${i++}`;
    out.push(opts.links ? <UrlLink key={k} url={url} max={opts.max} /> : <UrlPiece key={k} url={url} max={opts.max} />);
    last = m.index + url.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A one-line label (a step's title, a row): addresses in it shown shortened, in link colour. */
export function LinkedLabel({ text, links = false, max }: { text: string; links?: boolean; max?: number }) {
  if (!text.includes("://")) return <>{text}</>;
  return <>{withUrls(text, { links, max })}</>;
}
