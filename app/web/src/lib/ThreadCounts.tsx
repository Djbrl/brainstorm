// Owner: C (words and numbers). The Track lens header's count line: the same step count as the line above the
// sidebar (MapStats), the new files, what failed and the screenshots. Never Track's internal "stops".
import { plural, useThreadNumbers } from "./words";

export function TrackCounts({ sessionId, failed, screenshots }: { sessionId: string; failed: number; screenshots: number }) {
  const n = useThreadNumbers(sessionId);
  const head = n ? [plural(n.steps, "step"), n.created ? plural(n.created, "new file") : ""].filter(Boolean).join(" · ") : "";
  const tail = screenshots ? plural(screenshots, "screenshot") : "";
  return (
    <p>
      {head}
      {failed ? <>{head ? " · " : ""}<span className="err">{failed.toLocaleString()} failed</span></> : null}
      {tail ? `${head || failed ? " · " : ""}${tail}` : ""}
    </p>
  );
}
