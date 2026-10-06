// commandWrites: the files a shell command writes or deletes, read from the command text.
const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { commandWrites } = require(join(__dirname, "..", "dist", "listener", "command-writes.js"));

const CWD = "/work/site";
process.env.HOME = "/home/me";

/** "write /a" / "delete /b" lines, so a case reads at a glance. */
const run = (cmd, cwd = CWD) => commandWrites(cmd, cwd).map((w) => `${w.kind} ${w.path}`);
const w = (...paths) => paths.map((p) => `write ${p}`);

// ── redirects ──

test("redirects: >, >>, 1>, &>, >|, and stderr to a file", () => {
  assert.deepEqual(run("echo hi > out.txt"), w("/work/site/out.txt"));
  assert.deepEqual(run("echo hi >> log/out.txt"), w("/work/site/log/out.txt"));
  assert.deepEqual(run("echo hi 1> a.txt"), w("/work/site/a.txt"));
  assert.deepEqual(run("make &> build.log"), w("/work/site/build.log"));
  assert.deepEqual(run("echo hi >| keep.txt"), w("/work/site/keep.txt"));
  assert.deepEqual(run("make 2> err.log"), w("/work/site/err.log"));
  assert.deepEqual(run("echo hi >/abs/x.txt"), w("/abs/x.txt"));
  assert.deepEqual(run("echo hi>tight.txt"), w("/work/site/tight.txt"));
});

test("a redirect with no command, and one after a pipe", () => {
  assert.deepEqual(run("> empty.txt"), w("/work/site/empty.txt"));
  assert.deepEqual(run("ls | sort > sorted.txt"), w("/work/site/sorted.txt"));
});

test("cat > f <<'EOF' and cat <<EOF > f", () => {
  assert.deepEqual(run("cat > notes.md <<'EOF'\nhello\nEOF"), w("/work/site/notes.md"));
  assert.deepEqual(run("cat <<EOF > notes.md\nhello\nEOF"), w("/work/site/notes.md"));
  assert.deepEqual(run("cat <<-EOF >> notes.md\n\thello\n\tEOF"), w("/work/site/notes.md"));
});

test("a heredoc whose body has > characters and shell-looking text does not count", () => {
  assert.deepEqual(run("cat > README.md <<'EOF'\n# Title\n> quote\nsed -i x y\nrm -rf z\n> other.md\nEOF"), w("/work/site/README.md"));
});

test("what comes after the heredoc is read again", () => {
  assert.deepEqual(run("cat > a.txt <<EOF\nx\nEOF\nrm b.txt"), ["write /work/site/a.txt", "delete /work/site/b.txt"]);
});

test("tee, with and without -a, several files", () => {
  assert.deepEqual(run("echo x | tee out.txt"), w("/work/site/out.txt"));
  assert.deepEqual(run("echo x | tee -a one.txt two.txt"), w("/work/site/one.txt", "/work/site/two.txt"));
  assert.deepEqual(run("echo x | sudo tee /etc/hosts"), w("/etc/hosts"));
});

// ── sed, perl, ruby in place ──

test("sed -i: GNU and BSD forms", () => {
  assert.deepEqual(run("sed -i 's/a/b/' x.ts"), w("/work/site/x.ts"));
  assert.deepEqual(run("sed -i '' 's/a/b/' x.ts"), w("/work/site/x.ts"));
  assert.deepEqual(run("sed -i.bak 's/a/b/' x.ts"), w("/work/site/x.ts"));
  assert.deepEqual(run("sed -i -e 's/a/b/' x.ts y.ts"), w("/work/site/x.ts", "/work/site/y.ts"));
  assert.deepEqual(run("sed --in-place 's/a/b/' x.ts"), w("/work/site/x.ts"));
  assert.deepEqual(run("sed --in-place=.orig 's/a/b/' x.ts"), w("/work/site/x.ts"));
  assert.deepEqual(run("sed -Ei '' 's/a+/b/' x.ts"), w("/work/site/x.ts"));
  assert.deepEqual(run("sed -i '1d' x.ts"), w("/work/site/x.ts"));
});

test("sed -i with -e: every operand is a file, and the script is not", () => {
  assert.deepEqual(run("sed -i '' -e 's/foo/bar/g' src/a.ts src/b.ts"), w("/work/site/src/a.ts", "/work/site/src/b.ts"));
  assert.deepEqual(run("sed -i -f script.sed x.ts"), w("/work/site/x.ts"));
});

test("sed without -i only prints", () => {
  assert.deepEqual(run("sed -n 1,20p f"), []);
  assert.deepEqual(run("sed 's/a/b/' f > g"), w("/work/site/g"));
});

test("perl and ruby in place", () => {
  assert.deepEqual(run("perl -pi -e 's/a/b/' x.pl y.pl"), w("/work/site/x.pl", "/work/site/y.pl"));
  assert.deepEqual(run("perl -i -pe 's/a/b/' x.pl"), w("/work/site/x.pl"));
  assert.deepEqual(run("perl -pi.bak -e 's/a/b/' x.pl"), w("/work/site/x.pl"));
  assert.deepEqual(run("ruby -pi -e 'gsub(/a/, \"b\")' x.rb"), w("/work/site/x.rb"));
  assert.deepEqual(run("perl -ne 'print if /a/' x.pl"), []);
});

// ── mv, cp, rm and the rest ──

test("mv: the new path is written (from the old), the old one is deleted", () => {
  assert.deepEqual(commandWrites("mv a.txt b.txt", CWD), [
    { path: "/work/site/b.txt", kind: "write", from: "/work/site/a.txt" },
    { path: "/work/site/a.txt", kind: "delete" },
  ]);
});

test("mv into a directory: with a trailing slash, with several sources, with -t", () => {
  assert.deepEqual(run("mv a.txt dir/"), ["write /work/site/dir/a.txt", "delete /work/site/a.txt"]);
  assert.deepEqual(run("mv -f a.txt b.txt dir"), [
    "write /work/site/dir/a.txt", "delete /work/site/a.txt", "write /work/site/dir/b.txt", "delete /work/site/b.txt",
  ]);
  assert.deepEqual(run("mv -t dir a.txt"), ["write /work/site/dir/a.txt", "delete /work/site/a.txt"]);
});

test("cp, cp -r, install", () => {
  assert.deepEqual(run("cp a.txt b.txt"), w("/work/site/b.txt"));
  assert.deepEqual(run("cp -r src dst"), w("/work/site/dst"));
  assert.deepEqual(run("cp a.txt b.txt dir/"), w("/work/site/dir/a.txt", "/work/site/dir/b.txt"));
  assert.deepEqual(run("cp -p /abs/a.txt out/"), w("/work/site/out/a.txt"));
  assert.deepEqual(run("install -m 755 tool bin/tool"), w("/work/site/bin/tool"));
  assert.deepEqual(run("install -d bin"), []);
});

test("cp to a backup with brace expansion is not known", () => {
  assert.deepEqual(run("cp app.vue{,.bak}"), []);
});

test("touch, rm, truncate, dd", () => {
  assert.deepEqual(run("touch a.txt b.txt"), w("/work/site/a.txt", "/work/site/b.txt"));
  assert.deepEqual(run("touch -t 202401010000 a.txt"), w("/work/site/a.txt"));
  assert.deepEqual(run("rm -rf build dist/x.js"), ["delete /work/site/build", "delete /work/site/dist/x.js"]);
  assert.deepEqual(run("rm -f -- -odd"), ["delete /work/site/-odd"]);
  assert.deepEqual(run("truncate -s 0 app.log"), w("/work/site/app.log"));
  assert.deepEqual(run("dd if=/dev/zero of=blob.bin bs=1k count=4"), w("/work/site/blob.bin"));
});

test("ln is skipped", () => {
  assert.deepEqual(run("ln -s a.txt link.txt"), []);
});

test("git checkout -- f, git checkout <ref> -- f, git restore, git rm", () => {
  assert.deepEqual(run("git checkout -- a.ts b.ts"), w("/work/site/a.ts", "/work/site/b.ts"));
  assert.deepEqual(run("git checkout HEAD~1 -- a.ts"), w("/work/site/a.ts"));
  assert.deepEqual(run("git restore a.ts"), w("/work/site/a.ts"));
  assert.deepEqual(run("git restore --source=HEAD~2 a.ts"), w("/work/site/a.ts"));
  assert.deepEqual(run("git -C sub restore a.ts"), w("/work/site/sub/a.ts"));
  assert.deepEqual(run("git rm old.ts"), ["delete /work/site/old.ts"]);
});

test("git commands that do not touch files in the folder", () => {
  assert.deepEqual(run("git checkout main"), []);
  assert.deepEqual(run("git checkout -b feature"), []);
  assert.deepEqual(run("git restore --staged a.ts"), []);
  assert.deepEqual(run("git rm --cached a.ts"), []);
  assert.deepEqual(run("git checkout -- ."), []);
  assert.deepEqual(run("git apply fix.patch"), []);
  assert.deepEqual(run("patch -p1 < fix.patch"), []);
  assert.deepEqual(run("git status"), []);
});

// ── apply_patch ──

test("apply_patch: update, add, delete", () => {
  const cmd = "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/x.ts\n@@\n-a\n+b\n*** Add File: src/y.ts\n+new\n*** Delete File: src/z.ts\n*** End Patch\nEOF";
  assert.deepEqual(run(cmd), ["write /work/site/src/x.ts", "write /work/site/src/y.ts", "delete /work/site/src/z.ts"]);
});

test("apply_patch: Move to writes the new path from the old and deletes the old", () => {
  const cmd = "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@\n-a\n+b\n*** End Patch\nEOF";
  assert.deepEqual(commandWrites(cmd, CWD), [
    { path: "/work/site/old.ts", kind: "delete" },
    { path: "/work/site/new.ts", kind: "write", from: "/work/site/old.ts" },
  ]);
});

test("apply_patch inside bash -lc, after cd, and given as an argument", () => {
  const patch = "*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch";
  assert.deepEqual(run(`cd app && apply_patch <<'EOF'\n${patch}\nEOF`), w("/work/site/app/a.txt"));
  assert.deepEqual(run(`bash -lc "apply_patch <<'EOF'\n${patch}\nEOF"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`apply_patch '${patch}'`), w("/work/site/a.txt"));
});

// ── cd, sequencing, quoting ──

test("cd moves the folder for what follows", () => {
  assert.deepEqual(run("cd sub && sed -i '' s/a/b/ x.ts"), w("/work/site/sub/x.ts"));
  assert.deepEqual(run("cd /abs/dir; touch f.txt"), w("/abs/dir/f.txt"));
  assert.deepEqual(run("cd a && cd b && touch f"), w("/work/site/a/b/f"));
  assert.deepEqual(run("cd .. && touch f"), w("/work/f"));
});

test("cd inside ( ) stays inside; cd to an unknown place makes relative paths unknown", () => {
  assert.deepEqual(run("(cd sub && touch a) && touch b"), w("/work/site/sub/a", "/work/site/b"));
  assert.deepEqual(run("cd $SOMEWHERE && touch rel.txt && touch /abs.txt"), w("/abs.txt"));
});

test("a multi-line command: ; && || | and newlines", () => {
  const cmd = "mkdir -p out\ncd out\ntouch a || touch b; echo x | tee c\nrm d && rm e";
  assert.deepEqual(run(cmd), ["write /work/site/out/a", "write /work/site/out/b", "write /work/site/out/c", "delete /work/site/out/d", "delete /work/site/out/e"]);
});

test("env assignments, sudo, time and friends in front", () => {
  assert.deepEqual(run("FOO=1 BAR=2 touch a.txt"), w("/work/site/a.txt"));
  assert.deepEqual(run("env FOO=1 touch a.txt"), w("/work/site/a.txt"));
  assert.deepEqual(run("sudo -n rm /etc/x"), ["delete /etc/x"]);
  assert.deepEqual(run("time nohup touch a.txt"), w("/work/site/a.txt"));
  assert.deepEqual(run("if true; then rm a; fi"), ["delete /work/site/a"]);
  assert.deepEqual(run("/bin/rm a"), ["delete /work/site/a"]);
});

test("quoting: spaces, escapes, and a > inside a string", () => {
  assert.deepEqual(run("touch 'my file.txt' \"other file.txt\" esc\\ aped.txt"), w("/work/site/my file.txt", "/work/site/other file.txt", "/work/site/esc aped.txt"));
  assert.deepEqual(run('echo "a > b"'), []);
  assert.deepEqual(run("echo 'a > b' >> real.txt"), w("/work/site/real.txt"));
  assert.deepEqual(run("echo a \\> b"), []);
  assert.deepEqual(run("echo hi # > not-a-file"), []);
});

test("~ becomes HOME; variables, globs, substitutions and process substitution are skipped", () => {
  assert.deepEqual(run("echo x > ~/notes.txt"), w("/home/me/notes.txt"));
  assert.deepEqual(run("echo x > $HOME/notes.txt"), w("/home/me/notes.txt"));
  assert.deepEqual(run("echo $X > $OUT"), []);
  assert.deepEqual(run("echo x > ${OUT}/a.txt"), []);
  assert.deepEqual(run('echo x > "$DIR/a.txt"'), []);
  assert.deepEqual(run("rm *.log"), []);
  assert.deepEqual(run("rm file?.txt"), []);
  assert.deepEqual(run("echo x > $(mktemp)"), []);
  assert.deepEqual(run("echo x > `mktemp`"), []);
  assert.deepEqual(run("diff <(sort a) <(sort b)"), []);
  assert.deepEqual(run("tee >(cat > /dev/null)"), []);
});

test("results are normalized, deduplicated (last kind wins), in order of first appearance", () => {
  assert.deepEqual(run("touch ./a/../b.txt sub//c.txt"), w("/work/site/b.txt", "/work/site/sub/c.txt"));
  assert.deepEqual(run("touch a b a && rm b"), ["write /work/site/a", "delete /work/site/b"]);
  assert.deepEqual(run("rm a; touch a"), w("/work/site/a"));
  assert.deepEqual(run("echo x > a.txt; echo y >> a.txt"), w("/work/site/a.txt"));
});

test("scratch folders are returned too: the caller filters by project", () => {
  assert.deepEqual(run("echo x > /tmp/scratch.txt"), w("/tmp/scratch.txt"));
});

// ── things that are not writes ──

test("reads, test runs and /dev targets are not writes", () => {
  for (const cmd of ["cat f", "grep x f > /dev/null", "ls > /dev/null 2>&1", "npm test", "echo hi >&2", "ls 2>/dev/null", "echo x > /dev/stderr",
    "git diff | head", "node script.js", "python3 build.py", "cat f | python3 -", "rg foo src", "", "   ", "echo 'unterminated"]) {
    assert.deepEqual(run(cmd), [], cmd);
  }
});

test("garbage never throws", () => {
  for (const cmd of ["(((", ")))", "<<", "> ", "python3 - <<'PY'\nopen(", "node -e \"fs.writeFileSync(\"", "sed -i", "mv", "cp a", "'", "\"", "$(", "`", "perl -e", "git", "tee"]) {
    assert.doesNotThrow(() => commandWrites(cmd, CWD), cmd);
  }
  assert.deepEqual(commandWrites(undefined, CWD), []);
});

// ── bash -c ──

test("bash -c and sh -c run their text as shell, with the same folder", () => {
  assert.deepEqual(run("bash -c 'cd sub && touch a.txt'"), w("/work/site/sub/a.txt"));
  assert.deepEqual(run('bash -lc "sed -i s/a/b/ x.ts"'), w("/work/site/x.ts"));
  assert.deepEqual(run("sh -c 'echo x > out.txt'"), w("/work/site/out.txt"));
  assert.deepEqual(run("bash <<'EOF'\nrm a.txt\nEOF"), ["delete /work/site/a.txt"]);
  assert.deepEqual(run("bash script.sh"), []);
  assert.deepEqual(run(`zsh -lc "bash -c 'touch deep.txt'"`), w("/work/site/deep.txt"));
});

// ── python ──

test("real shape 1: python heredoc, Path in a variable, write_text", () => {
  const cmd = "python3 - <<'PY'\nfrom pathlib import Path\np=Path('app.vue'); s=p.read_text()\ns=s.replace('a','b')\np.write_text(s)\nPY";
  assert.deepEqual(run(cmd), w("/work/site/app.vue"));
});

test("real shape 2: a backup in /tmp, then the script's write", () => {
  const cmd = "mkdir -p /tmp/x\ncp app.vue /tmp/x/app.before.vue\npython3 - <<'PY'\nfrom pathlib import Path\np=Path('app.vue')\nt=p.read_text().replace('a','b')\np.write_text(t)\nPY";
  assert.deepEqual(run(cmd), w("/tmp/x/app.before.vue", "/work/site/app.vue"));
});

test("python: open() with write modes, positional and mode=", () => {
  for (const mode of ["'w'", "'a'", "'x'", "'wb'", "'r+'", "'w+'", "mode='w'", "mode=\\\"a\\\""]) {
    assert.deepEqual(run(`python3 -c "open('f.txt', ${mode}).write('x')"`), w("/work/site/f.txt"), mode);
  }
  assert.deepEqual(run("python3 - <<'PY'\nwith open('out/data.json', 'w') as fh:\n    fh.write('{}')\nPY"), w("/work/site/out/data.json"));
  assert.deepEqual(run("python3 - <<'PY'\nimport json\njson.dump(d, open('d.json','w'))\nPY"), w("/work/site/d.json"));
});

test("python: read-only open is not a write", () => {
  assert.deepEqual(run(`python3 -c "print(open('f').read())"`), []);
  assert.deepEqual(run(`python3 -c "open('f', 'r').read(); open('g', 'rb')"`), []);
  assert.deepEqual(run(`python3 -c "open(name, 'w')"`), []);
});

test("python: Path(...).write_text / write_bytes / unlink / touch / open", () => {
  assert.deepEqual(run(`python3 -c "from pathlib import Path; Path('a.txt').write_text('x')"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`python3 -c "Path('a.bin').write_bytes(b'x')"`), w("/work/site/a.bin"));
  assert.deepEqual(run(`python3 -c "Path('a.txt').unlink()"`), ["delete /work/site/a.txt"]);
  assert.deepEqual(run(`python3 -c "Path('a.txt').touch()"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`python3 -c "Path('a.txt').open('w').write('x')"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`python3 -c "Path('a.txt').open().read()"`), []);
  assert.deepEqual(run(`python3 -c "Path('a.txt').resolve().write_text('x')"`), w("/work/site/a.txt"));
});

test("python: paths built from literals", () => {
  assert.deepEqual(run(`python3 -c "(Path('src') / 'a.py').write_text('x')"`), w("/work/site/src/a.py"));
  assert.deepEqual(run("python3 - <<'PY'\nd = Path('src')\nf = d / 'sub' / 'a.py'\nf.write_text('x')\nPY"), w("/work/site/src/sub/a.py"));
  assert.deepEqual(run("python3 - <<'PY'\nPath('a', 'b.txt').write_text('x')\nPY"), w("/work/site/a/b.txt"));
  assert.deepEqual(run("python3 - <<'PY'\nimport os\nname = os.path.join('src', 'a.py')\nopen(name, 'w')\nPY"), w("/work/site/src/a.py"));
  assert.deepEqual(run("python3 - <<'PY'\nPath('~/x.txt').expanduser().write_text('x')\nPY"), w("/home/me/x.txt"));
});

test("python: a path from a variable that is not a literal is skipped, and the last assignment wins", () => {
  assert.deepEqual(run("python3 - <<'PY'\np = Path(sys.argv[1])\np.write_text('x')\nPY"), []);
  assert.deepEqual(run("python3 - <<'PY'\nfor f in files:\n    Path(f).write_text('x')\nPY"), []);
  assert.deepEqual(run("python3 - <<'PY'\np = Path('a.txt')\np = Path('b.txt')\np.write_text('x')\nPY"), w("/work/site/b.txt"));
  assert.deepEqual(run("python3 - <<'PY'\np = Path('a.txt') if x else Path('b.txt')\np.write_text('x')\nPY"), []);
  assert.deepEqual(run("python3 - <<'PY'\nf'{x}.txt'\nopen(f'{x}.txt', 'w')\nPY"), []);
});

test("python: os.remove, os.unlink, shutil.copy, shutil.move, os.rename, os.replace", () => {
  assert.deepEqual(run(`python3 -c "import os; os.remove('a'); os.unlink('b')"`), ["delete /work/site/a", "delete /work/site/b"]);
  assert.deepEqual(run(`python3 -c "import shutil; shutil.copy('a', 'b'); shutil.copy2('a', 'c')"`), w("/work/site/b", "/work/site/c"));
  assert.deepEqual(run(`python3 -c "shutil.move('a', 'b')"`), ["write /work/site/b", "delete /work/site/a"]);
  assert.deepEqual(run(`python3 -c "os.rename('a', 'b')"`), ["write /work/site/b", "delete /work/site/a"]);
  assert.deepEqual(run(`python3 -c "os.replace('a', 'b')"`), ["write /work/site/b", "delete /work/site/a"]);
  assert.deepEqual(run(`python3 -c "shutil.rmtree('build')"`), ["delete /work/site/build"]);
  assert.deepEqual(commandWrites(`python3 -c "os.rename('a', 'b')"`, CWD)[0], { path: "/work/site/b", kind: "write", from: "/work/site/a" });
});

test("python: a script file is not looked into, and a heredoc given to it is its input", () => {
  assert.deepEqual(run("python3 tool.py <<'EOF'\nopen('x', 'w')\nEOF"), []);
  assert.deepEqual(run("python3 -u - <<'PY'\nopen('x', 'w')\nPY"), w("/work/site/x"));
  assert.deepEqual(run("python3.11 -c \"open('x', 'w')\""), w("/work/site/x"));
  assert.deepEqual(run("python3 <<< \"open('x', 'w')\""), w("/work/site/x"));
});

test("python after cd: relative paths in the script use the new folder", () => {
  assert.deepEqual(run("cd sub && python3 - <<'PY'\nopen('a.txt', 'w')\nPY"), w("/work/site/sub/a.txt"));
});

// ── node ──

test("node: writeFileSync, appendFileSync, writeFile, promises", () => {
  assert.deepEqual(run(`node -e "require('fs').writeFileSync('a.json', '{}')"`), w("/work/site/a.json"));
  assert.deepEqual(run(`node -e "fs.appendFileSync('a.log', 'x')"`), w("/work/site/a.log"));
  assert.deepEqual(run(`node -e "fs.writeFile('a.txt', 'x', () => {})"`), w("/work/site/a.txt"));
  assert.deepEqual(run("node - <<'JS'\nawait fs.promises.writeFile('a.txt', 'x')\nJS"), w("/work/site/a.txt"));
  assert.deepEqual(run("node - <<'JS'\nconst fs = require('fs');\nfs.writeFileSync(\"b.txt\", `x`);\nJS"), w("/work/site/b.txt"));
  assert.deepEqual(run(`node --eval "writeFileSync('c.txt', 'x')"`), w("/work/site/c.txt"));
});

test("node: path.join of literals, variables, process.cwd()", () => {
  assert.deepEqual(run(`node -e "fs.writeFileSync(path.join('src', 'a.js'), 'x')"`), w("/work/site/src/a.js"));
  assert.deepEqual(run("node - <<'JS'\nconst f = path.join(__dirname, 'x.txt');\nfs.writeFileSync(f, 'x');\nJS"), w("/work/site/x.txt"));
  assert.deepEqual(run("node - <<'JS'\nfs.writeFileSync(path.resolve(process.cwd(), 'y.txt'), 'x')\nJS"), w("/work/site/y.txt"));
  assert.deepEqual(run(`node -e "fs.writeFileSync(path.join(process.argv[1], 'a.js'), 'x')"`), []);
  assert.deepEqual(run(`node -e "fs.writeFileSync(\\\`\\\${dir}/a.js\\\`, 'x')"`), []);
});

test("node: unlink, rm, rename, copyFile, and a bare rename() is not fs", () => {
  assert.deepEqual(run(`node -e "fs.unlinkSync('a'); fs.rmSync('b', {recursive: true})"`), ["delete /work/site/a", "delete /work/site/b"]);
  assert.deepEqual(run(`node -e "fs.renameSync('a', 'b')"`), ["write /work/site/b", "delete /work/site/a"]);
  assert.deepEqual(run(`node -e "fs.copyFileSync('a', 'b')"`), w("/work/site/b"));
  assert.deepEqual(run(`node -e "rename('a', 'b'); rm('c')"`), []);
  assert.deepEqual(run(`node -e "console.log(fs.readFileSync('a', 'utf8'))"`), []);
  assert.deepEqual(run(`node -e "fs.writeFileSync(1, 'x')"`), []);
});

// ── ruby and perl ──

test("ruby: File.write, File.open modes, File.delete, FileUtils", () => {
  assert.deepEqual(run(`ruby -e "File.write('a.txt', 'x')"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`ruby -e "File.open('a.txt', 'w') { |f| f << 'x' }"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`ruby -e "File.open('a.txt') { |f| f.read }"`), []);
  assert.deepEqual(run(`ruby -e "File.delete('a', 'b')"`), ["delete /work/site/a", "delete /work/site/b"]);
  assert.deepEqual(run(`ruby -e "FileUtils.mv 'a', 'b'"`), ["write /work/site/b", "delete /work/site/a"]);
  assert.deepEqual(run("ruby <<'RB'\nFile.write 'bare.txt', 'x'\nRB"), w("/work/site/bare.txt"));
  assert.deepEqual(run(`ruby -e 'File.write("#{dir}/a", 1)'`), []);
});

test("perl: open modes, unlink, rename", () => {
  assert.deepEqual(run(`perl -e "open(my \\$fh, '>', 'a.txt'); print \\$fh 'x'"`), w("/work/site/a.txt"));
  assert.deepEqual(run(`perl -e 'open(my $fh, ">>", "a.txt")'`), w("/work/site/a.txt"));
  assert.deepEqual(run(`perl -e 'open(FH, ">a.txt")'`), w("/work/site/a.txt"));
  assert.deepEqual(run(`perl -e 'open my $fh, "<", "a.txt" or die'`), []);
  assert.deepEqual(run(`perl -e 'open(my $fh, "<:encoding(UTF-8)", "a.txt")'`), []);
  assert.deepEqual(run(`perl -e 'open(my $fh, ">:encoding(UTF-8)", "a.txt")'`), w("/work/site/a.txt"));
  assert.deepEqual(run(`perl -e 'unlink("a", "b")'`), ["delete /work/site/a", "delete /work/site/b"]);
  assert.deepEqual(run(`perl -e 'rename("a", "b")'`), ["write /work/site/b", "delete /work/site/a"]);
  assert.deepEqual(run(`perl -e 'my $f = "x.txt"; open(my $fh, ">", $f)'`), w("/work/site/x.txt"));
});

test("scripts are found in the order they appear, across shell and script", () => {
  const cmd = "echo a > first.txt\npython3 - <<'PY'\nopen('second.txt', 'w')\nos.remove('third.txt')\nPY\ntouch fourth.txt";
  assert.deepEqual(run(cmd), ["write /work/site/first.txt", "write /work/site/second.txt", "delete /work/site/third.txt", "write /work/site/fourth.txt"]);
});
