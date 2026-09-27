import type { AskRequest, AskResponse } from "@contract";
import { replayAnswer, isReplay } from "./live";

export async function ask(req: AskRequest): Promise<AskResponse> {
  if (isReplay()) return replayAnswer(req);
  const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  if (!r.ok) throw new Error(`ask failed: ${r.status}`);
  return r.json();
}
