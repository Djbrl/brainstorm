// commandReads: the files a shell command reads, read from the command text (cases from a real review thread).
const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { commandReads } = require(join(__dirname, "..", "dist", "listener", "command-writes.js"));

const CWD = "/work/repo";
process.env.HOME = "/home/me";
const run = (cmd, cwd = CWD) => commandReads(cmd, cwd);

test("cat, head, tail, wc, nl, less: their operands", () => {
  assert.deepEqual(run("cat docs/technical.md"), ["/work/repo/docs/technical.md"]);
  assert.deepEqual(run("cat docs/attention.md; echo ======; cat docs/cowork.md"), ["/work/repo/docs/attention.md", "/work/repo/docs/cowork.md"]);
  assert.deepEqual(run("head -n 40 app/a.ts && tail -20 app/b.ts"), ["/work/repo/app/a.ts", "/work/repo/app/b.ts"]);
  assert.deepEqual(run("wc -l app/a.ts app/b.ts"), ["/work/repo/app/a.ts", "/work/repo/app/b.ts"]);
  assert.deepEqual(run("cat /etc/hosts -"), ["/etc/hosts"]);
});

test("sed -n reads its files; sed -i writes them, so it reads none", () => {
  assert.deepEqual(run("sed -n 1,400p /home/me/.claude/x/tool-results/b.txt"), ["/home/me/.claude/x/tool-results/b.txt"]);
  assert.deepEqual(run("sed -n -e '1,5p' a.ts b.ts"), ["/work/repo/a.ts", "/work/repo/b.ts"]);
  assert.deepEqual(run("sed -i 's/a/b/' a.ts"), []);
});

test("grep and rg: the pattern isn't a file; -e and -f move it out of the way; folders are kept", () => {
  assert.deepEqual(run("grep -n -i 'nemotron\\|label' plugin/README.md | head -40"), ["/work/repo/plugin/README.md"]);
  assert.deepEqual(run("grep -rn 'setInterval' app/server/src"), ["/work/repo/app/server/src"]);
  assert.deepEqual(run("grep -e foo -e bar a.ts"), ["/work/repo/a.ts"]);
  assert.deepEqual(run("rg -n --glob '*.ts' useThread app/web/src"), ["/work/repo/app/web/src"]);
  assert.deepEqual(run("grep -c x"), []);   // stdin
});

test("cd moves the folder; < file is a read; globs and variables are left out", () => {
  assert.deepEqual(run("cd /other/docs/review; cat web-map-canvas.md"), ["/other/docs/review/web-map-canvas.md"]);
  assert.deepEqual(run("wc -l < app/a.ts"), ["/work/repo/app/a.ts"]);
  assert.deepEqual(run("cat app/*.ts $FILE"), []);
  assert.deepEqual(run("for f in $(find . -name '*.ts'); do wc -l $f; done"), []);
});

test("bash -c is looked into; a file it also writes isn't a read", () => {
  assert.deepEqual(run("bash -c 'cat docs/a.md; head -3 docs/b.md'"), ["/work/repo/docs/a.md", "/work/repo/docs/b.md"]);
  assert.deepEqual(run("cat a.md > b.md"), ["/work/repo/a.md"]);
  assert.deepEqual(run("cat a.md > a.md"), []);
});

test("awk and jq: the program first, then the files", () => {
  assert.deepEqual(run("awk '{print $1}' app/log.txt"), ["/work/repo/app/log.txt"]);
  assert.deepEqual(run("jq '.version' plugin/plugin.json"), ["/work/repo/plugin/plugin.json"]);
});

test("never throws, and commands that read nothing", () => {
  assert.deepEqual(run("git log --oneline | head -5 && git worktree list"), []);
  assert.deepEqual(run("npm test"), []);
  assert.deepEqual(run("echo 'unterminated"), []);
});
