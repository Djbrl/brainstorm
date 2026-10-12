// One long input must not freeze the server: the pathological shapes of the regexes that were quadratic.
//
// Each shape is timed at a quarter of its size and at full size, in the same run: linear work takes about 4 times as
// long, quadratic work 16 times. Comparing the two sizes (best of a few runs each, since load only ever adds time)
// proves the same thing a fixed millisecond limit did, without failing when the machine is busy.
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeText } from "../listener/text";
import { commandWrites } from "../listener/command-writes";
import { EMAIL, maskEmails } from "../replay/privacy";
import { maskSecrets } from "../privacy/mask";

/** The time of one call of `fn`, in ms. */
const once = (fn: () => unknown) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
/** Under this, the full size is quick whatever the curve (a quadratic shape at these sizes takes seconds). */
const QUICK_MS = 5;
/** 4 times the input in under this many times the time: linear (4) or n log n passes, quadratic (16) fails. */
const MAX_GROWTH = 8;

/**
 * `make(k)` builds the input at k times the shape's size and returns the work to time. The two sizes are timed in
 * turn (so a burst of load hits both) and the best of each kept; a shape that looks too slow is timed once more,
 * longer, before it fails: load can fool one measurement, a quadratic shape fails every one.
 */
const fast = (name: string, make: (k: number) => () => unknown) => {
  const small = make(0.25), full = make(1);
  small(); full(); // warm up (the regex compiles, the JIT settles)
  const measure = (runs: number) => {
    let a = Infinity, b = Infinity;
    for (let i = 0; i < runs; i++) { a = Math.min(a, once(small)); b = Math.min(b, once(full)); }
    return { a, b, ok: b < QUICK_MS || b / Math.max(a, 0.01) < MAX_GROWTH };
  };
  let m = measure(3);
  if (!m.ok) m = measure(7);
  assert.ok(m.ok, `${name}: ${m.a.toFixed(1)} ms at a quarter of the size, ${m.b.toFixed(1)} ms at full size (not linear)`);
};
/** `s` repeated to about n characters. */
const rep = (s: string, n: number) => s.repeat(Math.max(1, Math.ceil(n / s.length)));

test("sanitizeText: 500 KB with no space or line break is cut, not masked whole", () => {
  fast("letters", (k) => { const s = rep("a", 500_000 * k); return () => sanitizeText(s); });
  fast("sk- run", (k) => { const s = rep("sk-", 500_000 * k); return () => sanitizeText(s); });
});

test("sanitizeText: a key straddling the cut of a text with no break is still masked", () => {
  const key = "sk-ant-" + "A1b2C3d4".repeat(8);
  const s = "x".repeat(19_990) + key + "y".repeat(100_000);
  const out = sanitizeText(s, 20_000);
  assert.ok(!out.includes("sk-ant-A1b2"), "the key leaked");
  assert.ok(out.endsWith("…(truncated)"));
});

test("email: a long run of word characters, and the 64-character local part", () => {
  const swap = (s: string) => s.replace(EMAIL, "[email]");
  fast("letters then @", (k) => { const s = rep("a", 32_000 * k) + "@"; return () => swap(s); }); // 64 steps a character, not the whole run
  fast("a@a.", (k) => { const s = "a@" + rep("a.", 200_000 * k); return () => swap(s); });
  fast("a long local part, widened back", (k) => { const s = rep("a", 32_000 * k) + "@b.co " + rep("c", 32_000 * k); return () => maskEmails(s); });
  assert.equal(swap("mail ana.lee@example.com."), "mail [email].");
  assert.equal(maskEmails("x".repeat(80) + "@foo.org"), "[email]"); // an over-long local part is masked whole
  assert.equal(maskEmails("to " + "y".repeat(70) + "@foo.org, git@github.com:a/b and ana@x.io"), "to [email], git@github.com:a/b and [email]");
});

test("maskSecrets: 500 KB of a hyphenated run takes linear time", () => {
  fast("sk-", (k) => { const s = rep("sk-", 300_000 * k); return () => maskSecrets(s); });
});

test("maskSecrets: the key-name, header, URL, command-line, .netrc, .pgpass and YAML rules take linear time", () => {
  const N = 200_000;
  /** Every shape at about n characters. */
  const shapes = (n: number): Record<string, string> => ({
    "name=": rep("a=", n), "name:": rep("a:", n), 'name="': rep('a="', n), "name='b ": rep("a='b ", n), "password=x(": rep("password=abc123(", n),
    "password: x ": rep("password: x ", n), "pw: x line": rep("pw: x\n", n), "DB_PASS=": rep("DB_PASS=", n), "api_key run": rep("api_key", n),
    "open quote": 'password: "' + rep("x", n), "escapes in quotes": 'password: "' + rep("\\x", n),
    "authorization": rep("authorization: ", n), "authorization scheme": rep("Authorization: Bearer x ", n),
    "cookie": rep("cookie: a=", n), "x-api-key": rep("x-api-key: ", n), "Bearer": rep("Bearer ", n), "?code=": rep("?code=", n),
    "scheme://": rep("http://", n), "scheme://user:": rep("http://a:", n), "scheme://key@": rep("http://aaaaaaaaaaaaaaaaaaaaaaa1@", n),
    "slack": rep("hooks.slack.com/services/", n), "discord": rep("discord.com/api/webhooks/12345/", n),
    "machine": rep("machine a ", n), "machine login": rep("machine a login b ", n), "password line": rep("\n password ", n),
    "docker login": rep("docker login ", n), "sshpass": rep("sshpass -x ", n), "mysql -p": rep("mysql -p ", n),
    "pgpass": rep("a:1:b:c:", n), "pgpass lines": rep("a:1:b:c:d e\n", n),
    "yaml block keys": rep("password: |\n", n), "yaml block lines": "password: |\n" + rep("  y\n", n),
    "letters then =": rep("a", n) + "=", "a-": rep("a-", n),
  });
  for (const name of Object.keys(shapes(1))) fast(name, (k) => { const s = shapes(N * k)[name]; return () => maskSecrets(s); });
});

test("commandWrites: a long run of braces, open and spaces", () => {
  fast("braces", (k) => { const c = "echo > " + rep("{", 65_536 * k); return () => commandWrites(c, "/w"); });
  fast("braces and commas", (k) => { const c = "echo > " + rep("{,", 65_536 * k); return () => commandWrites(c, "/w"); });
  fast("perl open", (k) => { const c = "perl -e 'open" + rep(" ", 65_536 * k) + "'"; return () => commandWrites(c, "/w"); });
  fast("patch header", (k) => { const c = "apply_patch <<'EOF'\n*** Update File: a" + rep(" ", 65_536 * k) + "b\nEOF"; return () => commandWrites(c, "/w"); });
  fast("patch move", (k) => { const c = "apply_patch <<'EOF'\n*** Update File: a\n*** Move to: a" + rep(" ", 65_536 * k) + "b\nEOF"; return () => commandWrites(c, "/w"); });
});

test("commandWrites: brace lists, perl open and patch headers still read", () => {
  assert.deepEqual(commandWrites("echo > a{,.bak}", "/w"), []); // a brace list: which files is not known
  assert.deepEqual(commandWrites("echo > a{b}", "/w").map((w) => w.path), ["/w/a{b}"]);
  assert.deepEqual(commandWrites("perl -e 'open ( my $fh , \">x\" )'", "/w").map((w) => w.path), ["/w/x"]);
  const patch = "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: src/a.ts   \n*** Move to: src/b.ts\t\n*** End Patch\nEOF";
  assert.deepEqual(commandWrites(patch, "/w").map((w) => `${w.kind} ${w.path}`), ["delete /w/src/a.ts", "write /w/src/b.ts"]);
});
