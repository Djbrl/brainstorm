// Owner: C. Tiny hand-rolled markdown: paragraphs, headings, bullet/numbered lists, `code`, **bold**, *italic*, fenced code blocks,
// [links](https://…) and bare web addresses (whole address in link colour, shortened in the middle: lib/links.tsx).
import type { ReactNode } from "react";
import { trimUrl, UrlLink } from "../lib/links";

const TOKEN = /(`[^`]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>"'`]+|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(TOKEN.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    let tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (/^https?:/.test(tok)) {
      tok = trimUrl(tok);
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(<UrlLink key={k} url={tok} />);
      last = re.lastIndex = m.index + tok.length;
      continue;
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    if (tok.startsWith("`")) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      out.push(<a key={k} className="md-link" href={href} target="_blank" rel="noreferrer noopener" title={href}>{label}</a>);
    }
    else if (tok.startsWith("**")) out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    else out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={b++} className="md-pre"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push(<p key={b++} className="md-h">{inline(h[2], `h${b}`)}</p>); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(<ul key={b++}>{items.map((t, j) => <li key={j}>{inline(t, `u${b}-${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      const start = Number(/^\s*(\d+)/.exec(line)![1]); // "2) yes" is the second item, not the first
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol key={b++} start={start !== 1 ? start : undefined}>{items.map((t, j) => <li key={j}>{inline(t, `o${b}-${j}`)}</li>)}</ol>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|[-*•]\s+|\d+[.)]\s+|#{1,4}\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={b++}>{inline(para.join(" "), `p${b}`)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
