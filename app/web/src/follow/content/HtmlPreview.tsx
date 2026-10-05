// Owner: viewers. An HTML file as a page: rendered in a sandboxed frame, scaled down from a desktop width to fit the
// panel. Nothing in it runs and nothing leaves the machine: the frame allows no scripts, forms, popups or navigation
// (sandbox with no permissions), and the page's own policy refuses every request except styles and images written
// into it. So its own stylesheet links and pictures by path don't show: the layout and the text do.
import { useEffect, useRef, useState } from "react";

const WIDTH = 1280, HEIGHT = 800;   // the page is laid out as on a laptop, then scaled to the panel
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:">`;

export function HtmlPreview({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [tall, setTall] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = w ? w / WIDTH : 0, h = tall ? HEIGHT * 2 : HEIGHT;
  return (
    <div className="cv-html" ref={box}>
      <div className="cv-html-frame" style={{ height: h * k }}>
        {k > 0 && (
          <iframe title="Page preview" sandbox="" referrerPolicy="no-referrer" loading="lazy" srcDoc={POLICY + html}
            style={{ width: WIDTH, height: h, transform: `scale(${k})` }} />
        )}
      </div>
      <button className="cv-more" onClick={() => setTall((t) => !t)}>{tall ? "Show less of the page" : "Show more of the page"}</button>
    </div>
  );
}

/** Preview or code, for an HTML file. */
export function ViewSwitch({ view, onView }: { view: "page" | "code"; onView: (v: "page" | "code") => void }) {
  return (
    <span className="cv-switch" role="tablist" aria-label="Show as">
      <button role="tab" aria-selected={view === "page"} className={view === "page" ? "on" : ""} onClick={() => onView("page")}>Page</button>
      <button role="tab" aria-selected={view === "code"} className={view === "code" ? "on" : ""} onClick={() => onView("code")}>Code</button>
    </span>
  );
}

export const isHtml = (path: string | undefined | null) => /\.html?$/i.test(path ?? "");
/** Text that reads as a page (its markup), not a stretch of an HTML file's style or script. */
export const PAGE_MARKUP = /<\s*(!doctype|html|head|body|main|header|section|div|article|nav)\b/i;
