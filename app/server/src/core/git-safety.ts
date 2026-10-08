// Every git this server runs (listing files, times, status) inherits these settings. A project copied from somewhere
// (a zip with its .git folder, not a fresh clone) can carry a .git/config that names a program for git to run, such as
// core.fsmonitor: with this, git never runs it. Git reads GIT_CONFIG_COUNT/KEY/VALUE (2.31+) above the repo's own config.
const SAFE: [string, string][] = [["core.fsmonitor", "false"], ["core.hooksPath", "/dev/null"]];

export function protectGit(env: NodeJS.ProcessEnv = process.env): void {
  let n = Number(env.GIT_CONFIG_COUNT);
  if (!Number.isInteger(n) || n < 0) n = 0;
  for (const [key, value] of SAFE) { env[`GIT_CONFIG_KEY_${n}`] = key; env[`GIT_CONFIG_VALUE_${n}`] = value; n++; }
  env.GIT_CONFIG_COUNT = String(n);
}
