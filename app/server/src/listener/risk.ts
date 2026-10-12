import type { Step } from "../shared/contract";

// Rule-based risk flags on an edit (an .env file, auth, payment, a deleted test, a big deletion, a possible secret),
// from the step itself. Set when the step is stored (inStoredOrder), live or from history alike. No model.

const SECRET_RES = [
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9_\-]{20,}/,
  /['"](?:[A-Za-z0-9_\-]{32,})['"]/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
];

export function riskOf(step: Pick<Step, "kind" | "filePath" | "diff">): string[] | undefined {
  if (step.kind !== "edit" || !step.filePath) return undefined;
  const risks: string[] = [];
  const fp = step.filePath;
  if (/(^|\/)(\.env(\.\w+)?|.*\.env)$/.test(fp)) risks.push("touches .env");
  if (/(auth|login|session|jwt|oauth)/i.test(fp)) risks.push("touches auth");
  if (/(payment|billing|stripe|checkout)/i.test(fp)) risks.push("touches payment");
  if (/\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(fp) && step.diff) {
    const beforeLen = step.diff.before.trim().length;
    const afterLen = step.diff.after.trim().length;
    if (beforeLen > 40 && afterLen < beforeLen * 0.3) risks.push("deleted test");
  }
  if (step.diff) {
    const beforeLines = step.diff.before ? step.diff.before.split("\n").length : 0;
    const afterLines = step.diff.after ? step.diff.after.split("\n").length : 0;
    if (beforeLines - afterLines > 50) risks.push("large deletion");
    const combined = (step.diff.before ?? "") + (step.diff.after ?? "");
    if (SECRET_RES.some((re) => re.test(combined))) risks.push("possible secret");
  }
  return risks.length ? risks : undefined;
}
