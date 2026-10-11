import { Injectable } from "@nestjs/common";
import { config } from "./config";

@Injectable()
export class ConfigService {
  /** Where Claude Code writes session logs. RUNDOWN_CLAUDE_DIR points it at a copy (benchmarks, tests). */
  readonly claudeProjectsDir = config.claudeProjectsDir;
  /** Codex's home (~/.codex, or CODEX_HOME): its session logs are in sessions/ and archived_sessions/. RUNDOWN_CODEX_DIR
   * points it at a copy (benchmarks, tests). */
  readonly codexDir = config.codexDir;
  readonly claude = {
    key: config.anthropicKey,
    model: config.claudeModel,
  };
}
