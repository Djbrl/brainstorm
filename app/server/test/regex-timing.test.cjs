// One long input must not freeze the server: the pathological shapes of the regexes that were quadratic.
const test = require("node:test");
const assert = require("node:assert/strict");
const { dist } = require("./helpers.cjs");
require("reflect-metadata");
const { sanitizeText } = require(dist("listener/text.js"));
const { commandWrites } = require(dist("listener/command-writes.js"));
const { EMAIL } = require(dist("replay/privacy.js"));
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
  assert.equal(swap("mail ana.lee@example.com."), "mail [email].");
  assert.equal(swap("x".repeat(80) + "@foo.org"), "x".repeat(16) + "[email]"); // the front of an over-long one stays
});

test("maskSecrets: 500 KB of a hyphenated run takes linear time", () => {
  fast("sk-", () => maskSecrets("sk-".repeat(100_000)), 100);
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
