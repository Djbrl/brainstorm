// Owner: viewers. Pictures opened large over the page (a screenshot a tool took, an image an agent read): fitted to
// the window, ← → between a step's pictures, Esc or a click outside closes. One picture is loaded at a time, the one on
// show (the browser keeps the ones already seen in its cache).
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Lightbox({ srcs, at, label, onAt, onClose }: { srcs: string[]; at: number; label: string; onAt: (i: number) => void; onClose: () => void }) {
  const n = srcs.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight" && n > 1) { e.preventDefault(); e.stopPropagation(); onAt((at + 1) % n); }
      else if (e.key === "ArrowLeft" && n > 1) { e.preventDefault(); e.stopPropagation(); onAt((at - 1 + n) % n); }
    };
    // Capture: the map's replay keys (← →) and Esc (closing the step) don't also act.
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [at, n, onAt, onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={`${label} ${at + 1} of ${n}`} onClick={onClose}>
      <img src={srcs[at]} alt={`${label} ${at + 1}`} decoding="async" onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        {n > 1 && <button onClick={() => onAt((at - 1 + n) % n)} aria-label="Previous">‹</button>}
        {n > 1 && <span>{at + 1} of {n}</span>}
        {n > 1 && <button onClick={() => onAt((at + 1) % n)} aria-label="Next">›</button>}
        <a href={srcs[at]} target="_blank" rel="noreferrer noopener">Full size</a>
        <button onClick={onClose} aria-label="Close">Close</button>
      </div>
    </div>,
    document.body,
  );
}
