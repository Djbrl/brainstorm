import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { StatementSync } from "node:sqlite";
import type { Step } from "../types";
import { BusService } from "../core/bus.service";
import { DbService } from "../core/db.service";

const SECRET_RES = [
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9_\-]{20,}/,
  /['"](?:[A-Za-z0-9_\-]{32,})['"]/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
];

// Owner: B. Listens to bus "step" and flags risky edits (an .env file, auth, payment, a deleted test, a big deletion, a
// possible secret) from the step itself, at once. No model.
@Injectable()
export class ReaderService implements OnModuleInit {
  private log = new Logger("Reader");
  private stmts?: { setRisk: StatementSync };

  constructor(private bus: BusService, private dbs: DbService) {}

  /** Prepared on first use: the listener creates the steps table in its own init. */
  private get q() {
    return this.stmts ??= { setRisk: this.dbs.db.prepare(`UPDATE steps SET risk = ? WHERE id = ?`) };
  }

  private storeRisk(id: string, risk: string[]) {
    this.q.setRisk.run(JSON.stringify(risk), id);
  }

  onModuleInit() {
    this.bus.on("step", (step) => this.onStep(step));
  }

  private onStep(step: Step) {
    if (step.kind !== "edit") return;
    // Set here so the risk is in the first "step" message: the bus is synchronous and the listener broadcasts this same
    // object right after emitting it, so no step-update is needed.
    const risk = this.computeRisk(step);
    if (!risk) return;
    step.risk = risk;
    try { this.storeRisk(step.id, risk); } catch (e) { this.log.warn(`storing risk failed for ${step.id}: ${(e as Error).message}`); }
  }

  // ---- risk flags ----

  private computeRisk(step: Step): string[] | undefined {
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
}
