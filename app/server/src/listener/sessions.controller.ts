import { Controller, Get, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { StepsStore } from "./step-store";

// Threads and their steps: GET /api/sessions, GET /api/sessions/:id/steps and GET /api/steps/:id/input.
@Controller()
export class SessionsController {
  constructor(private store: StepsStore) {}
  @Get("sessions") sessions() { return this.store.listSessions(); }
  /** A session's steps in order. `?afterSeq=N`: only the steps after seq N (what a page that has them up to N needs). */
  @Get("sessions/:id/steps") steps(@Param("id") id: string, @Query("afterSeq") afterSeq: string | undefined, @Res() res: Response) {
    const after = typeof afterSeq === "string" && /^-?\d+$/.test(afterSeq) ? Number(afterSeq) : undefined;
    // The JSON text as built, not re-serialized, sent a page of steps at a time (waiting for the socket to drain), so
    // a long thread is never one big string. Edits come without the texts their diff repeats (Step.inputTrimmed).
    res.type("application/json");
    const pages = this.store.stepsJsonPages(id, after, { slim: true });
    const pump = () => {
      for (let r = pages.next(); !r.done; r = pages.next()) if (!res.write(r.value)) { res.once("drain", pump); return; }
      res.end();
    };
    res.on("close", () => { res.removeListener("drain", pump); });
    pump();
  }
  /** A step's whole input, `{ input }` (`{}` when it has none): an edit's old and new text, for a page that shows them. */
  @Get("steps/:id/input") input(@Param("id") id: string, @Res() res: Response) {
    const json = this.store.stepInputJson(id);
    if (json === undefined) throw new NotFoundException();
    res.type("application/json").send(json);
  }
}
