import { Injectable } from "@nestjs/common";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

@Injectable()
export class ConfigService {
  /** Where Claude Code writes session logs. */
  readonly claudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
  /** Project the map shows by default: the repo root (…/brainstorm). */
  readonly defaultRoot = resolve(process.env.MAP_ROOT ?? resolve(__dirname, "../../../.."));
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
