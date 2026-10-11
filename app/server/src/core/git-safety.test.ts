// A project copied with its .git folder can name programs for git to run (filters, diff drivers, gpg for signed
// commits), switched on by a .gitattributes line. None of the server's git calls may run them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "./git-safety";
import { GitService } from "../git/git.service";
import { gitLastCommitTimes, recentCommitTimes, recentCommitTimesSync } from "../mapper/git-times";
import { gitIgnored, listProjectFiles, listProjectFilesSync } from "../mapper/list-files";

const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe", env: { ...process.env, ...ID } }).toString();

test("a copied repo's filters, diff drivers, includes, submodules and gpg program never run", async () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "rd-gitsafe-")));
  const marker = join(tmp, "marker");
  try {
    // A program per driver that leaves its name in the marker file (and passes the content through).
    const mark = (what: string) => {
      const f = join(tmp, `run-${what}.sh`);
      writeFileSync(f, `#!/bin/sh\necho ${what} >> "${marker}"\ncat\n`, { mode: 0o755 });
      return f;
    };
    // A submodule whose own config has a filter.
    const sub = join(tmp, "sub");
    mkdirSync(sub); git(sub, "init", "-q", "-b", "main");
    writeFileSync(join(sub, "s.txt"), "s\n"); writeFileSync(join(sub, ".gitattributes"), "* filter=subx\n");
    git(sub, "add", "."); git(sub, "commit", "-qm", "one");

    const src = join(tmp, "src");
    mkdirSync(src); git(src, "init", "-q", "-b", "main");
    for (const f of ["a.ts", "b.ts", "c.ts"]) writeFileSync(join(src, f), `export const ${f[0]} = 1;\n`);
    writeFileSync(join(src, ".gitattributes"), "a.ts filter=evil diff=evil\nb.ts filter=inc\nc.ts filter=proc\n");
    git(src, "add", "."); git(src, "commit", "-qm", "one");
    git(src, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub"); git(src, "commit", "-qm", "sub");
    // A commit that claims a signature, so `git log` with log.showSignature runs gpg.program.
    const tree = git(src, "write-tree").trim(), parent = git(src, "rev-parse", "HEAD").trim();
    const raw = `tree ${tree}\nparent ${parent}\nauthor t <t@t> 1700000000 +0000\ncommitter t <t@t> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----\n\nsigned\n`;
    const signed = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: src, input: raw }).toString().trim();
    git(src, "update-ref", "HEAD", signed);

    git(src, "config", "filter.evil.clean", mark("clean"));
    git(src, "config", "filter.proc.process", mark("process"));
    git(src, "config", "diff.evil.textconv", mark("textconv"));
    git(src, "config", "log.showSignature", "true");
    git(src, "config", "gpg.program", mark("gpg"));
    writeFileSync(join(tmp, "inc.cfg"), `[filter "inc"]\n\tclean = ${mark("included")}\n`);
    git(src, "config", "include.path", "../../inc.cfg");
    git(join(src, "sub"), "config", "filter.subx.clean", mark("submodule"));

    // Copied, not cloned: the index's stat data no longer matches, so git hashes the files again (through the filters).
    const repo = join(tmp, "repo");
    cpSync(src, repo, { recursive: true });
    const stale = (dir: string) => { const t = new Date(Date.now() + 5000); for (const f of ["a.ts", "b.ts", "c.ts", "sub/s.txt"]) utimesSync(join(dir, f), t, t); };
    stale(repo);

    // The setup is real: plain git runs them.
    const control = join(tmp, "control");
    cpSync(src, control, { recursive: true }); stale(control);
    try { execFileSync("git", ["status", "--porcelain"], { cwd: control, stdio: "ignore" }); } catch { /* the process filter fails */ }
    try { execFileSync("git", ["log", "-1"], { cwd: control, stdio: "ignore" }); } catch { /* */ }
    const ran = readFileSync(marker, "utf8");
    for (const w of ["clean", "process", "included", "submodule", "gpg"]) assert.match(ran, new RegExp(w), `control ran ${w}`);
    rmSync(marker);

    const svc = new GitService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { listSessions: () => [] } as never, { status: () => ({ root: null }) } as never);
    const state = await svc.read(repo);
    assert.equal(state?.branch, "main");
    await gitLastCommitTimes(repo, new Set(["a.ts", "nothing.ts"]));
    await recentCommitTimes(repo); recentCommitTimesSync(repo);
    await listProjectFiles(repo, 1); listProjectFilesSync(repo, 1);
    await gitIgnored(repo, ["a.ts"]);
    // A driver added after the first run (an agent's `git config`) is pinned too.
    git(repo, "config", "filter.later.clean", mark("later"));
    writeFileSync(join(repo, ".gitattributes"), "* filter=later\n");
    stale(repo);
    await svc.read(repo);
    // And one that arrives in an included file (a pull can change a tracked one).
    writeFileSync(join(tmp, "inc.cfg"), `[filter "inc2"]\n\tclean = ${mark("included2")}\n`);
    writeFileSync(join(repo, ".gitattributes"), "* filter=inc2\n");
    stale(repo);
    await svc.read(repo);
    assert.equal(existsSync(marker) ? readFileSync(marker, "utf8") : "", "");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("gitEnv keeps the person's own settings and adds the pins after them", () => {
  const env = gitEnv(undefined, { LC_ALL: "C" });
  assert.equal(env.LC_ALL, "C");
  const n = Number(env.GIT_CONFIG_COUNT);
  const keys = Array.from({ length: n }, (_, i) => env[`GIT_CONFIG_KEY_${i}`]);
  assert.ok(keys.includes("core.fsmonitor") && keys.includes("log.showSignature"));
});
