// Owner: camera. The quiet corner button that frames the whole map again (F or 0 does the same).
import { FIT_TITLE } from "./camera";

export function FitButton({ onFit, label = "Fit to view" }: { onFit: () => void; label?: string }) {
  return (
    <button className="map-fit" onClick={onFit} aria-label={label} title={FIT_TITLE}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 5.5V3a1 1 0 0 1 1-1h2.5M10.5 2H13a1 1 0 0 1 1 1v2.5M14 10.5V13a1 1 0 0 1-1 1h-2.5M5.5 14H3a1 1 0 0 1-1-1v-2.5" />
        <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
