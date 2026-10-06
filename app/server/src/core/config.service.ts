import { Injectable } from "@nestjs/common";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { env } from "./local";

@Injectable()
export class ConfigService {
  /** Where Claude Code writes session logs. RUNDOWN_CLAUDE_DIR points it at a copy (benchmarks, tests). */
  readonly claudeProjectsDir = env("CLAUDE_DIR") ?? process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
  /** Codex's home (~/.codex, or CODEX_HOME): its session logs are in sessions/ and archived_sessions/. RUNDOWN_CODEX_DIR
   * points it at a copy (benchmarks, tests). */
  readonly codexDir = env("CODEX_DIR") ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  /** Project the map shows by default: the repo root. */
  /** Active workspace. Mutable: set by the setup screen (WorkspaceService). */
  defaultRoot = resolve(process.env.MAP_ROOT ?? env("ROOT") ?? resolve(__dirname, "../../../.."));
  readonly nemotron = {
    url: process.env.NEMOTRON_URL ?? "http://localhost:8000/v1",
    key: process.env.NEMOTRON_KEY ?? "",
    model: process.env.NEMOTRON_MODEL ?? "nemotron",
  };
  readonly claude = {
    key: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
  };
}
