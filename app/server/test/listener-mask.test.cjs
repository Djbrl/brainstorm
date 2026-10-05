// sanitizeText cuts long texts before masking them: what is kept must be masked exactly as if the whole text was.
const test = require("node:test");
const assert = require("node:assert/strict");
const { dist } = require("./helpers.cjs");
require("reflect-metadata");
const { sanitizeText } = require(dist("listener/listener.service.js"));
const { maskSecrets } = require(dist("privacy/mask.js"));

/** The old way: mask all of it, then clip. */
const reference = (s, limit) => { const m = maskSecrets(s); return m.length > limit ? m.slice(0, limit) + "\n…(truncated)" : m; };

const SECRETS = [
  "sk-ant-api03-" + "A".repeat(90),
  "sk-proj-" + "b".repeat(40),
  "ghp_" + "c".repeat(36),
  "AKIA" + "D".repeat(16),
  "xoxb-" + "1".repeat(30),
  "AIza" + "e".repeat(35),
  "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0".repeat(30) + ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  "Authorization: Bearer " + "f".repeat(60),
  "postgres://admin:hunter2hunter2@db.example.com/app",
  '"password": "correct horse battery staple"',
  "API_KEY=" + "g".repeat(48),
  "--token " + "h".repeat(30),
];
const PEM = "-----BEGIN RSA PRIVATE KEY-----\n" + "MIIEowIBAAKCAQEA7\n".repeat(200) + "-----END RSA PRIVATE KEY-----";
const leaks = (out) => ["AAAAAAAAAA", "bbbbbbbbbb", "cccccccccc", "DDDDDDDDDD", "1111111111", "eeeeeeeeee", "SflKxwRJ", "ffffffffff", "hunter2", "horse battery", "gggggggggg", "hhhhhhhhhh", "MIIEowIBAAKCAQEA7"].filter((x) => out.includes(x));

test("short texts: unchanged behavior", () => {
  for (const s of ["", "hello", ...SECRETS, PEM]) assert.equal(sanitizeText(s, 20_000), reference(s, 20_000));
});

test("a secret across the cut, at every offset around it, for each kind of secret", () => {
  const limit = 2_000;
  // With line breaks the cut lands on one; without, on a space (inside "correct horse battery staple", say).
  for (const unit of ["lorem ipsum dolor sit amet\n", "lorem ipsum dolor sit amet "]) {
    const filler = (n) => unit.repeat(Math.ceil(n / unit.length) + 1).slice(0, n);
    for (const secret of [...SECRETS, PEM]) {
      for (let start = limit - 200; start <= limit + 1024 + 50; start += 7) {
        const s = filler(start) + "\n" + secret + " " + filler(6_000);
        const out = sanitizeText(s, limit);
        assert.equal(out, reference(s, limit), `secret ${secret.slice(0, 12)} at ${start}`);
        assert.deepEqual(leaks(out), [], `leak for ${secret.slice(0, 12)} at ${start}`);
      }
    }
  }
});

test("no line break or space near the cut (minified text), and keys that shrink a lot: falls back to masking all", () => {
  const limit = 2_000;
  const minified = "x".repeat(limit + 900) + "sk-ant-api03-" + "A".repeat(500) + "y".repeat(40_000);
  assert.equal(sanitizeText(minified, limit), reference(minified, limit));
  // Big keys before the limit shrink the text by thousands of chars: the tail moves inside the limit.
  const shrinking = (PEM + "\n").repeat(3) + "z ".repeat(600) + '"secret": "abc def ghi jkl"' + "\n" + "w ".repeat(20_000);
  const out = sanitizeText(shrinking, limit);
  assert.equal(out, reference(shrinking, limit));
  assert.deepEqual(leaks(out), []);
});

test("random texts with secrets around the cut: same output as masking everything", () => {
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const words = ["the", "agent", "ran", "tests", "é", "日本", "🚀", "\n", "  ", "{\"a\":1}", "path/to/file.ts", "=", ":"];
  for (let k = 0; k < 400; k++) {
    const limit = [2_000, 20_000][rnd(2)];
    const parts = [];
    let len = 0;
    const target = limit + 1024 + rnd(3_000) - 1_500;
    while (len < target + 5_000) {
      const p = rnd(12) === 0 ? (rnd(15) === 0 ? PEM : SECRETS[rnd(SECRETS.length)]) : words[rnd(words.length)] + (rnd(3) ? " " : "");
      parts.push(p);
      len += p.length;
    }
    const s = parts.join("");
    const out = sanitizeText(s, limit);
    assert.equal(out, reference(s, limit), `case ${k}`);
  }
});
