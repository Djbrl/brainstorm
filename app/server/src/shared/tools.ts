// Tool names by what they do, one list each for the server and the web. Each list holds exactly the names its users
// have always matched; a user that needs one more name (apply_patch, LS) adds it where it's used.

/** Tools that change a file. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
/** Tools that read one file. */
export const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "NotebookRead"]);
/** Tools that search the project's code. */
export const CODE_SEARCH_TOOLS: ReadonlySet<string> = new Set(["Grep", "Glob", "LS"]);
/** Tools that look something up, in the code or on the web (a thread's count of searches). */
export const SEARCH_TOOLS: ReadonlySet<string> = new Set(["Grep", "Glob", "WebSearch", "WebFetch", "ToolSearch"]);
/** Tools that start a subagent. */
export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);
/** Tools that run a shell command or read one's output (Claude Code's and Codex's). */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(["Bash", "BashOutput", "exec_command", "shell", "local_shell", "KillShell"]);
