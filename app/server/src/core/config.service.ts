import { Injectable } from "@nestjs/common";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir, env } from "./local";

@Injectable()
export class ConfigService {
  /** Where Claude Code writes session logs. RUNDOWN_CLAUDE_DIR points it at a copy (benchmarks, tests). */
  readonly claudeProjectsDir = env("CLAUDE_DIR") ?? process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
  /** Codex's home (~/.codex, or CODEX_HOME): its session logs are in sessions/ and archived_sessions/. RUNDOWN_CODEX_DIR
   * points it at a copy (benchmarks, tests). */
  readonly codexDir = env("CODEX_DIR") ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  /** Active workspace. Mutable: set by the setup screen (WorkspaceService). Until one is chosen: MAP_ROOT, the repo in
   * dev, and for the plugin a folder that doesn't exist, so nothing is read, mapped or watched before the person picks. */
  defaultRoot = resolve(process.env.MAP_ROOT ?? env("ROOT") ?? (env("DATA_DIR") ? join(dataDir(), "no-project-yet") : resolve(__dirname, "../../../..")));
  readonly claude = {
    key: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
  };
}
