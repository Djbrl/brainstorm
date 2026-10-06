// Git view tests: reading `git status`, and the whole state of a real temporary repo (uncommitted, unpushed, a
// worktree with its own commits and edits). Run: cd app/server && npx tsc -p . && node --test dist/git/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitService, parseStatus } from "./git.service";

test("parseStatus reads the branch, counts and each file's state", () => {
  const out = ["# branch.oid abc", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +3 -1",
    "1 .M N... 100644 100644 100644 aaa bbb src/a b.ts", "1 A. N... 000000 100644 100644 000 ccc new.ts",
    "1 D. N... 100644 000000 000000 ddd 000 gone.ts",
    "2 R. N... 100644 100644 100644 ddd eee R100 moved.ts", "old.ts", "u UU N... 1 2 3 4 h1 h2 h3 both.ts", "? untracked file.md", ""].join("\0");
  assert.deepEqual(parseStatus(out), {
    branch: "main", upstream: "origin/main", ahead: 3, behind: 1,
    files: { "src/a b.ts": "modified", "new.ts": "added", "gone.ts": "deleted", "moved.ts": "renamed", "both.ts": "conflict", "untracked file.md": "untracked" },
  });
  assert.equal(parseStatus("# branch.head (detached)\0").branch, null);
});

test("read: uncommitted, unpushed, and a worktree's own commits and edits", async () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "bs-git-")));
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString();
  try {
    const remote = join(tmp, "remote.git"), repo = join(tmp, "repo");
    git(tmp, "init", "-q", "--bare", "-b", "main", remote);
    git(tmp, "clone", "-q", remote, repo);
    git(repo, "checkout", "-q", "-b", "main");
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src/a.ts"), "a\n"); writeFileSync(join(repo, "b.ts"), "b\n");
    git(repo, "add", "."); git(repo, "commit", "-q", "-m", "one"); git(repo, "push", "-q", "-u", "origin", "main");
    writeFileSync(join(repo, "b.ts"), "b2\n"); git(repo, "commit", "-qam", "two");          // committed, not pushed
    writeFileSync(join(repo, "src/a.ts"), "a2\n"); writeFileSync(join(repo, "new.md"), "n\n"); // not committed
    const wt = join(tmp, "wt");
    git(repo, "worktree", "add", "-q", "-b", "agent", wt);
    writeFileSync(join(wt, "src/c.ts"), "c\n"); git(wt, "add", "."); git(wt, "commit", "-qm", "agent work"); // on the branch
    writeFileSync(join(wt, "b.ts"), "b3\n");                                                                  // not committed there

    const svc = new GitService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { listSessions: () => [{ id: "s1", cwd: wt }] } as never, { status: () => ({ root: null }) } as never);
    const s = (await svc.read(repo))!;
    assert.equal(s.branch, "main"); assert.equal(s.upstream, "origin/main"); assert.equal(s.ahead, 1); assert.equal(s.behind, 0);
    assert.deepEqual(s.uncommitted, { "src/a.ts": "modified", "new.md": "untracked" });
    assert.deepEqual(s.unpushed, ["b.ts"]);
    assert.equal(s.worktrees.length, 1);
    const w = s.worktrees[0];
    assert.equal(w.branch, "agent"); assert.equal(w.ahead, 1); assert.equal(w.merged, false);
    assert.deepEqual(w.committed, ["src/c.ts"]); assert.deepEqual(w.uncommitted, { "b.ts": "modified" }); assert.deepEqual(w.threads, ["s1"]);
    // The map's root inside the repo: paths are relative to it, files outside it are left out.
    const sub = (await svc.read(join(repo, "src")))!;
    assert.deepEqual(sub.uncommitted, { "a.ts": "modified" }); assert.deepEqual(sub.unpushed, []); assert.deepEqual(sub.worktrees[0].committed, ["c.ts"]);
    assert.equal(await svc.read(tmp), null);   // not a repo
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
