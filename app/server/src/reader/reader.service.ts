import { Injectable } from "@nestjs/common";

// Owner: B. Listens to bus "step" → Nemotron label (≤8 words) → ws "step-update". File + module summaries, cached by hash.
@Injectable()
export class ReaderService {
  /** Used by ask (D) to ground answers. */
  getFileSummary(_path: string): string | undefined { return undefined; }
  getModuleSummary(_module: string): string | undefined { return undefined; }
}
