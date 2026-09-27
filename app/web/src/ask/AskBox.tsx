// Owner: C. Reused by Follow (stepId) and Map (filePath). Shows answer, model and cost.
import type { AskRequest } from "@contract";

export function AskBox(_props: { context: Omit<AskRequest, "question">; placeholder?: string }) {
  return null;
}
