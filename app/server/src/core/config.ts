// Every setting the server reads from its environment, in one place: the only file that reads process.env (git-safety.ts
// copies the whole environment for the git it runs; tests set variables). Each knob is read when it's asked for, so a
// variable set after start (app/.env in dev, a test) still counts. app/.env.example is generated from KNOBS
// (node app/scripts/env-example.mjs, after a server build).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { LANDING_URL } from "./urls";

/** A setting, for app/.env.example: its variable, what it does, and an example value (shown commented out). `hidden`
 * ones are for the plugin's launcher, benchmarks and tests, and stay out of the example. */
export interface Knob { name: string; about: string; example?: string; hidden?: boolean }

export const KNOBS: Knob[] = [
  { name: "RUNDOWN_PORT", about: "The port the server listens on (127.0.0.1 only). Optional; the default is 4000. PORT works too.", example: "4000" },
  { name: "PORT", about: "", hidden: true },
  { name: "RUNDOWN_ROOT", about: "The project to show is chosen in the app. To start on a given folder instead, set RUNDOWN_ROOT (optional).", example: "/path/to/your/project" },
  { name: "MAP_ROOT", about: "", hidden: true },
  { name: "ANTHROPIC_API_KEY", about: "Ask: questions about a step or a file go to Claude. Optional; without a key, Ask is off and the rest works.", example: "" },
  { name: "CLAUDE_MODEL", about: "The model Ask uses (optional; the default is claude-opus-5).", example: "claude-opus-5" },
  { name: "ANTHROPIC_WORKSPACE_ID", about: "Only if your key is not scoped to a workspace (optional).", example: "" },
  { name: "RUNDOWN_MAX_FILES", about: "At most this many files on the map (optional; the default is 3000).", example: "3000" },
  { name: "RUNDOWN_MAP_WATCH", about: "How the map watches the disk: folders or recursive (optional; the platform's cheap mode by default).", example: "folders" },
  { name: "RUNDOWN_UPDATE_CHECK", about: "0 turns the check for a newer version off (optional).", example: "0" },
  { name: "RUNDOWN_USAGE", about: "off turns the anonymous usage counts off, whatever the setting in the app (optional). DO_NOT_TRACK=1 does too.", example: "off" },
  { name: "DO_NOT_TRACK", about: "", hidden: true },
  { name: "RUNDOWN_USAGE_DEV", about: "1 lets a dev build send the usage counts (for testing the report; optional).", example: "1" },
  { name: "RUNDOWN_USAGE_URL", about: "Where the usage counts go (for testing the report; optional).", example: "http://127.0.0.1:3000/api/usage" },
  { name: "RUNDOWN_CLAUDE_DIR", about: "", hidden: true },
  { name: "CLAUDE_PROJECTS_DIR", about: "", hidden: true },
  { name: "RUNDOWN_CODEX_DIR", about: "", hidden: true },
  { name: "CODEX_HOME", about: "", hidden: true },
  { name: "RUNDOWN_DATA_DIR", about: "", hidden: true },
  { name: "RUNDOWN_WEB_DIR", about: "", hidden: true },
  { name: "RUNDOWN_SHARE_TEMPLATE", about: "", hidden: true },
  { name: "RUNDOWN_VERSION", about: "", hidden: true },
  { name: "RUNDOWN_LOCK_TOKEN", about: "", hidden: true },
  { name: "RUNDOWN_NO_SETTINGS", about: "", hidden: true },
  { name: "RUNDOWN_PLUGIN_ID", about: "", hidden: true },
  { name: "HOME", about: "", hidden: true },
];

type Name = (typeof KNOBS)[number]["name"];
const raw = (name: Name): string | undefined => process.env[name];

export const config = {
  /** The plugin's data folder (it sets RUNDOWN_DATA_DIR); unset in dev. Its presence means "running as the plugin". */
  get pluginDataDir(): string | undefined { return raw("RUNDOWN_DATA_DIR"); },
  /** Where Rundown keeps its database and private files: the plugin's data folder, or app/server/data in dev. */
  get dataDir(): string { return resolve(raw("RUNDOWN_DATA_DIR") ?? resolve(__dirname, "../../data")); },
  get port(): number { return Number(raw("RUNDOWN_PORT") ?? raw("PORT") ?? 4000); },
  /** The project the launcher (RUNDOWN_ROOT) asked for. */
  get launchRoot(): string | undefined { return raw("RUNDOWN_ROOT"); },
  /** The project shown until one is chosen: MAP_ROOT, RUNDOWN_ROOT, the repo in dev, and for the plugin a folder that
   * doesn't exist, so nothing is read, mapped or watched before the person picks. */
  get startRoot(): string {
    return resolve(raw("MAP_ROOT") ?? raw("RUNDOWN_ROOT") ?? (raw("RUNDOWN_DATA_DIR") ? join(this.dataDir, "no-project-yet") : resolve(__dirname, "../../../..")));
  },
  /** Where Claude Code writes session logs. RUNDOWN_CLAUDE_DIR points it at a copy (benchmarks, tests). */
  get claudeProjectsDir(): string { return raw("RUNDOWN_CLAUDE_DIR") ?? raw("CLAUDE_PROJECTS_DIR") ?? join(homedir(), ".claude", "projects"); },
  /** Codex's home (~/.codex, or CODEX_HOME): its logs are in sessions/ and archived_sessions/. RUNDOWN_CODEX_DIR points it at a copy. */
  get codexDir(): string { return raw("RUNDOWN_CODEX_DIR") ?? raw("CODEX_HOME") ?? join(homedir(), ".codex"); },
  get anthropicKey(): string { return raw("ANTHROPIC_API_KEY") ?? ""; },
  get claudeModel(): string { return raw("CLAUDE_MODEL") ?? "claude-opus-5"; },
  get anthropicWorkspace(): string | undefined { return raw("ANTHROPIC_WORKSPACE_ID"); },
  /** The plugin's built web app, served by this server. */
  get webDir(): string | undefined { return raw("RUNDOWN_WEB_DIR"); },
  get shareTemplate(): string | undefined { return raw("RUNDOWN_SHARE_TEMPLATE"); },
  /** The plugin's version; unset in dev. */
  get version(): string | undefined { return raw("RUNDOWN_VERSION"); },
  get lockToken(): string | undefined { return raw("RUNDOWN_LOCK_TOKEN"); },
  get maxFiles(): number { return Number(raw("RUNDOWN_MAX_FILES")); },
  get mapWatch(): string | undefined { return raw("RUNDOWN_MAP_WATCH"); },
  get updateCheckOff(): boolean { return raw("RUNDOWN_UPDATE_CHECK") === "0"; },
  get usageUrl(): string { return raw("RUNDOWN_USAGE_URL") ?? `${LANDING_URL}/api/usage`; },
  get usageDev(): boolean { return raw("RUNDOWN_USAGE_DEV") === "1"; },
  /** Why the usage counts are off whatever the setting says, or null. */
  get usageLocked(): string | null {
    const dnt = raw("DO_NOT_TRACK"), off = raw("RUNDOWN_USAGE")?.toLowerCase();
    if (dnt && dnt !== "0" && dnt.toLowerCase() !== "false") return "DO_NOT_TRACK is set";
    if (off === "off" || off === "0" || off === "false") return "RUNDOWN_USAGE is off";
    return null;
  },
  /** The plugin started without its settings (an older Claude Code): a key added later needs a new session. */
  get noSettings(): boolean { return raw("RUNDOWN_NO_SETTINGS") === "1"; },
  get pluginId(): string { return raw("RUNDOWN_PLUGIN_ID") || "rundown@rundown"; },
  /** $HOME as the shell has it (for "~" in commands). */
  get home(): string | undefined { return raw("HOME") || undefined; },
};

/** Dev only: app/.env into the environment (variables already set win). The plugin passes its settings in the
 * environment, and must not pick up some .env above its install folder: its launcher always sets RUNDOWN_VERSION and
 * RUNDOWN_PLUGIN_ID. A dev server on a scratch data folder (RUNDOWN_DATA_DIR) still reads it. */
export function loadDevEnv(file = resolve(__dirname, "../../../.env")) {
  if (!config.version && !raw("RUNDOWN_PLUGIN_ID") && existsSync(file)) process.loadEnvFile(file);
}
