import { Injectable } from "@nestjs/common";
import type { AskRequest, AskResponse } from "../types";

// Owner: D.
@Injectable()
export class AskService {
  async ask(req: AskRequest): Promise<AskResponse> {
    return { answer: `(stub) You asked: ${req.question}`, model: "stub", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: false };
  }
  listAnswers(): { request: AskRequest; response: AskResponse }[] { return []; }
}
