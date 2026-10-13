// "Follow again": a small pill at the bottom of the map while the camera is yours (you dragged, zoomed or used the
// arrow keys). A click (or F, or Esc) gives the camera back to the director (useMapCamera.ts).
import "./follow-again.css";

export function FollowAgain({ show, bottom, onClick }: { show: boolean; bottom: number; onClick: () => void }) {
  if (!show) return null;
  return (
    <button className="follow-again" style={{ bottom: Math.max(16, bottom + 8) }} onClick={onClick} title="The camera frames the agents' work again (F)">
      Follow again
    </button>
  );
}
