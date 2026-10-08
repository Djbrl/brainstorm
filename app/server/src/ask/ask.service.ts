import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { AskRequest, AskResponse, Step } from "../types";
import { DbService } from "../core/db.service";
import { ConfigService } from "../core/config.service";
import { ListenerService } from "../listener/listener.service";
import { ReaderService } from "../reader/reader.service";
import { ClaudeService } from "../llm/claude.service";
import { NemotronService } from "../llm/nemotron.service";
import { maskSecrets } from "../privacy/mask";
import { UsageService } from "../usage/usage.service";

// Owner: D.
const SYSTEM = `You are Rundown, a guide to a codebase that AI coding agents are editing live.
Answer the question for someone learning this codebase. Use ONLY the context provided (file excerpt, summaries, the agent's recent steps and diff).
Be concise: 2 to 6 short sentences or a few bullets, plain language, name concrete files and functions.
If the context does not contain the answer, say so plainly and say what you would need to look at. Never invent code that is not shown.`;

/** Trim a cut-off answer back to its last complete sentence or list item, and say it was shortened. */
export function endAtSentence(text: string): string {
  const body = text.replace(/\s+\S*$/, ""); // drop the half word
  const i = Math.max(body.lastIndexOf(". "), body.lastIndexOf(".\n"), body.lastIndexOf("\n- "), body.lastIndexOf("\n\n"));
  const kept = i > body.length * 0.4 ? body.slice(0, i + 1).trimEnd() : `${body.trimEnd()}…`;
  return `${kept}\n\n*(Answer shortened: ask a narrower question for the rest.)*`;
}

/** USD per million tokens [input, output]. */
function pricing(model: string): [number, number] {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return [1, 5];
  if (m.includes("sonnet")) return [3, 15];
  return [5, 25]; // opus
}

const MAX_FILE_LINES = 150;
const clip = (s: string | undefined, n: number) => (!s ? "" : s.length > n ? s.slice(0, n) + "\n…(truncated)" : s);

@Injectable()
export class AskService implements OnModuleInit {
  private log = new Logger("Ask");
  constructor(
    private dbs: DbService,
    private cfg: ConfigService,
    private listener: ListenerService,
    private reader: ReaderService,
    private claude: ClaudeService,
    private nemotron: NemotronService,
    private usage: UsageService,
  ) {}

  onModuleInit() {
    this.dbs.db.exec(`CREATE TABLE IF NOT EXISTS ask_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL, step_id TEXT NOT NULL DEFAULT '', file_path TEXT NOT NULL DEFAULT '',
      file_hash TEXT NOT NULL DEFAULT '', request TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL)`);
    this.dbs.db.exec(`CREATE INDEX IF NOT EXISTS ask_answers_key ON ask_answers(question, step_id, file_path)`);
  }

  async ask(req: AskRequest): Promise<AskResponse> {
    const question = (req.question ?? "").trim();
    if (!question) return { answer: "Ask a question about this code.", model: "none", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: false };
    this.usage.bump("ak");

    const step: Step | undefined = req.stepId ? this.safe(() => this.listener.getStep(req.stepId!)) : undefined;
    let filePath = req.filePath ?? step?.filePath;
    if (filePath && !isAbsolute(filePath)) filePath = resolve(req.root ?? this.cfg.defaultRoot, filePath);
    const content = filePath ? this.safe(() => readFileSync(filePath!, "utf8")) : undefined;
    const fileHash = content !== undefined ? createHash("sha1").update(content).digest("hex") : "";
    const target = req.stepId ?? "";

    // Cache: same question + same target + unchanged file (only real Claude answers, so a fixed key is picked up).
    // Answers of exactly 700 tokens were cut off by the old limit (before 5 Oct 2026): ask again.
    const cached = this.dbs.db
      .prepare(`SELECT response FROM ask_answers WHERE question = ? AND step_id = ? AND file_path = ? AND file_hash = ? AND json_extract(response, '$.fallback') = 0 AND json_extract(response, '$.tokensOut') != 700 ORDER BY id DESC LIMIT 1`)
      .get(question, target, req.filePath ?? "", fileHash) as { response: string } | undefined;
    if (cached) return JSON.parse(cached.response) as AskResponse;

    const user = maskSecrets(this.buildContext(question, step, filePath, content, req.root));

    let res: AskResponse;
    try {
      // Room for a full answer (the prompt asks for a short one); a cut answer ends at its last full sentence.
      const r = await this.claude.complete(SYSTEM, user, 1500);
      if (r.cut) r.text = endAtSentence(r.text);
      const [pi, po] = pricing(r.model);
      const costUsd = +((r.tokensIn * pi + r.tokensOut * po) / 1e6).toFixed(6);
      res = { answer: r.text, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd, fallback: false };
    } catch (e) {
      this.log.warn(`Claude failed, falling back to Nemotron: ${(e as Error).message}`);
      if (!this.nemotron.enabled) {
        const answer = this.cfg.claude.key ? "Could not reach Claude right now. Try again in a moment." : `To ask questions, add an Anthropic API key: run /plugin configure ${process.env.RUNDOWN_PLUGIN_ID || "rundown@rundown"} in Claude Code, then start a new session.`;
        return { answer, model: "none", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: true };
      }
      try {
        const r = await this.nemotron.complete(SYSTEM, user, 500);
        res = { answer: r.text, model: this.cfg.nemotron.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: 0, fallback: true };
      } catch (e2) {
        this.log.error(`Nemotron failed too: ${(e2 as Error).message}`);
        return { answer: "Could not reach a model right now. Try again in a moment.", model: "none", tokensIn: 0, tokensOut: 0, costUsd: 0, fallback: true };
      }
    }

    this.safe(() => this.dbs.db
      .prepare(`INSERT INTO ask_answers (question, step_id, file_path, file_hash, request, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(question, target, req.filePath ?? "", fileHash, JSON.stringify(req), JSON.stringify(res), new Date().toISOString()));
    return res;
  }

  listAnswers(): { request: AskRequest; response: AskResponse }[] {
    const rows = this.safe(() => this.dbs.db.prepare(`SELECT request, response FROM ask_answers ORDER BY json_extract(response, '$.fallback') ASC, id DESC`).all() as { request: string; response: string }[]) ?? [];
    return rows.map((r) => ({ request: JSON.parse(r.request), response: JSON.parse(r.response) }));
  }

  private buildContext(question: string, step: Step | undefined, filePath: string | undefined, content: string | undefined, root?: string): string {
    const parts: string[] = [];
    const base = root ?? this.cfg.defaultRoot;
    const rel = filePath ? relative(base, filePath) : undefined;

    if (step) {
      const before: Step[] = this.safe(() => this.listener.stepsBefore(step.id, 3)) ?? [];
      if (before.length) parts.push("## What the agent did just before\n" + before.map((s) => `- ${this.describe(s)}`).join("\n"));
      parts.push("## The step in question\n" + this.describe(step));
      if (step.diff) parts.push(`## Its diff\n--- before\n${clip(step.diff.before, 3000)}\n+++ after\n${clip(step.diff.after, 3000)}`);
    }

    if (filePath && rel) {
      const modParts = rel.split("/");
      const moduleId = modParts.length > 2 ? modParts.slice(0, 2).join("/") : modParts.slice(0, -1).join("/") || ".";
      const fileSummary = this.safe(() => this.reader.getFileSummary(filePath));
      const moduleSummary = this.safe(() => this.reader.getModuleSummary(moduleId));
      parts.push(`## File: ${rel} (module ${moduleId})`);
      if (moduleSummary) parts.push(`Module summary: ${moduleSummary}`);
      if (fileSummary) parts.push(`File summary: ${fileSummary}`);
      if (content !== undefined) {
        const lines = content.split("\n");
        let start = 0;
        const anchor = step?.diff?.after?.split("\n").find((l) => l.trim().length > 8);
        if (anchor) {
          const i = lines.findIndex((l) => l.includes(anchor.trim()));
          if (i >= 0) start = Math.max(0, i - 40);
        }
        const slice = lines.slice(start, start + MAX_FILE_LINES);
        parts.push(`## Excerpt (lines ${start + 1}-${start + slice.length} of ${lines.length})\n` + slice.map((l, k) => `${start + k + 1}: ${l.slice(0, 240)}`).join("\n"));
      }
    }

    parts.push(`## Question\n${question}`);
    return parts.join("\n\n");
  }

  private describe(s: Step): string {
    const what = s.label ?? (s.kind === "tool_call" ? `${s.tool ?? "tool"} ${s.filePath ?? clip(JSON.stringify(s.input ?? ""), 200)}` : clip(s.text, 400));
    return `[${s.kind}${s.filePath ? ` ${s.filePath}` : ""}] ${what}`;
  }

  private safe<T>(fn: () => T): T | undefined {
    try { return fn(); } catch { return undefined; }
  }
}
