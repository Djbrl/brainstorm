// One long input must not freeze the server: the pathological shapes of the regexes that were quadratic.
const test = require("node:test");
const assert = require("node:assert/strict");
const { dist } = require("./helpers.cjs");
require("reflect-metadata");
const { sanitizeText } = require(dist("listener/text.js"));
const { commandWrites } = require(dist("listener/command-writes.js"));
const { EMAIL, maskEmails } = require(dist("replay/privacy.js"));
const { maskSecrets } = require(dist("privacy/mask.js"));

/** The time of `fn` in ms, after a warm-up call. */
function time(fn) {
  fn();
  const t0 = performance.now();
  const out = fn();
  return { ms: performance.now() - t0, out };
}
const fast = (name, fn, limit = 50) => {
  const { ms } = time(fn);
  assert.ok(ms < limit, `${name} took ${ms.toFixed(1)} ms`);
};

test("sanitizeText: 500 KB with no space or line break is cut, not masked whole", () => {
  fast("letters", () => sanitizeText("a".repeat(500_000)));
  fast("sk- run", () => sanitizeText("sk-".repeat(166_000)));
});

test("sanitizeText: a key straddling the cut of a text with no break is still masked", () => {
  const key = "sk-ant-" + "A1b2C3d4".repeat(8);
  const s = "x".repeat(19_990) + key + "y".repeat(100_000);
  const out = sanitizeText(s, 20_000);
  assert.ok(!out.includes("sk-ant-A1b2"), "the key leaked");
  assert.ok(out.endsWith("…(truncated)"));
});

test("email: a long run of word characters, and the 64-character local part", () => {
  const swap = (s) => s.replace(EMAIL, "[email]");
  fast("letters then @", () => swap("a".repeat(32_000) + "@")); // 64 steps a character, not the whole run
  fast("a@a.", () => swap("a@" + "a.".repeat(100_000)));
  fast("a long local part, widened back", () => maskEmails("a".repeat(32_000) + "@b.co " + "c".repeat(32_000)));
  assert.equal(swap("mail ana.lee@example.com."), "mail [email].");
  assert.equal(maskEmails("x".repeat(80) + "@foo.org"), "[email]"); // an over-long local part is masked whole
  assert.equal(maskEmails("to " + "y".repeat(70) + "@foo.org, git@github.com:a/b and ana@x.io"), "to [email], git@github.com:a/b and [email]");
});

test("maskSecrets: 500 KB of a hyphenated run takes linear time", () => {
  fast("sk-", () => maskSecrets("sk-".repeat(100_000)), 100);
});

test("maskSecrets: the key-name, header, URL, command-line, .netrc, .pgpass and YAML rules take linear time", () => {
  const run = (s) => s.repeat(Math.ceil(200_000 / s.length));
  const shapes = {
    "name=": run("a="), "name:": run("a:"), 'name="': run('a="'), "name='b ": run("a='b "), "password=x(": run("password=abc123("),
    "password: x ": run("password: x "), "pw: x line": run("pw: x\n"), "DB_PASS=": run("DB_PASS="), "api_key run": run("api_key"),
    "open quote": 'password: "' + "x".repeat(200_000), "escapes in quotes": 'password: "' + "\\x".repeat(100_000),
    "authorization": run("authorization: "), "authorization scheme": run("Authorization: Bearer x "),
    "cookie": run("cookie: a="), "x-api-key": run("x-api-key: "), "Bearer": run("Bearer "), "?code=": run("?code="),
    "scheme://": run("http://"), "scheme://user:": run("http://a:"), "scheme://key@": run("http://aaaaaaaaaaaaaaaaaaaaaaa1@"),
    "slack": run("hooks.slack.com/services/"), "discord": run("discord.com/api/webhooks/12345/"),
    "machine": run("machine a "), "machine login": run("machine a login b "), "password line": run("\n password "),
    "docker login": run("docker login "), "sshpass": run("sshpass -x "), "mysql -p": run("mysql -p "),
    "pgpass": run("a:1:b:c:"), "pgpass lines": run("a:1:b:c:d e\n"),
    "yaml block keys": run("password: |\n"), "yaml block lines": "password: |\n" + run("  y\n"),
    "letters then =": "a".repeat(200_000) + "=", "a-": run("a-"),
  };
  for (const [name, s] of Object.entries(shapes)) fast(name, () => maskSecrets(s), 100);
});

test("commandWrites: a long run of braces, open and spaces", () => {
  fast("braces", () => commandWrites("echo > " + "{".repeat(65_536), "/w"));
  fast("braces and commas", () => commandWrites("echo > " + "{,".repeat(32_768), "/w"));
  fast("perl open", () => commandWrites("perl -e 'open" + " ".repeat(65_536) + "'", "/w"));
  fast("patch header", () => commandWrites("apply_patch <<'EOF'\n*** Update File: a" + " ".repeat(65_536) + "b\nEOF", "/w"));
  fast("patch move", () => commandWrites("apply_patch <<'EOF'\n*** Update File: a\n*** Move to: a" + " ".repeat(65_536) + "b\nEOF", "/w"));
});

test("commandWrites: brace lists, perl open and patch headers still read", () => {
  assert.deepEqual(commandWrites("echo > a{,.bak}", "/w"), []); // a brace list: which files is not known
  assert.deepEqual(commandWrites("echo > a{b}", "/w").map((w) => w.path), ["/w/a{b}"]);
  assert.deepEqual(commandWrites("perl -e 'open ( my $fh , \">x\" )'", "/w").map((w) => w.path), ["/w/x"]);
  const patch = "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/a.ts   \n*** Move to: src/b.ts\t\n*** End Patch\nEOF";
  assert.deepEqual(commandWrites(patch, "/w").map((w) => `${w.kind} ${w.path}`), ["delete /w/src/a.ts", "write /w/src/b.ts"]);
});
