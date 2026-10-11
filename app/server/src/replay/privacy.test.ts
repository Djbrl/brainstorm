import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { computerNames, forSharing } from "./privacy";

test("the home folder goes, however it's written", () => {
  const home = homedir();
  const out = forSharing({
    plain: `${home}/code/app/notes.txt`,
    json: `{"path":"${home.replace(/\//g, "\\/")}\\/code"}`,
    url: `vscode://file?path=${encodeURIComponent(home)}%2Fcode`,
  });
  for (const v of Object.values(out)) assert.ok(!v.includes(home) && !v.includes(encodeURIComponent(home)) && !v.includes(home.replace(/\//g, "\\/")), v);
});

test("the computer's name is replaced as a whole word only", () => {
  const host = computerNames()[0];
  if (!host) return;
  const out = forSharing({ alone: `user@${host}:~$ ls`, inside: `x${host}y` });
  assert.ok(!out.alone.includes(host), out.alone);
  assert.equal(out.inside, `x${host}y`);
  for (const name of computerNames()) assert.ok(!forSharing(`ssh ${name} uptime`).includes(name), name);
});

test("secrets in shared text are masked", () => {
  const out = forSharing({ yaml: "password: hunter2hunter2", aws: "aws_secret_access_key = FAKEwJalrXUtnFEMIK7MDENGbPxRfiCYFAKEKEY" });
  assert.ok(!out.yaml.includes("hunter2") && !out.aws.includes("FAKEwJalr"), JSON.stringify(out));
});

const ana = { homes: ["/Users/ana"], user: "ana", hosts: ["Anas-MacBook-Pro", "Studio"], mailbox: "ana.lee", name: "Ana Lee" };

test("identities: exact case, whole words, distinctive names only; the mailbox before the account name", () => {
  const id = { ...ana, user: "anabel" };
  const s = (v: string) => forSharing(v, id);
  assert.equal(s("pushed by ana.lee to origin"), "pushed by [email] to origin");
  assert.equal(s("https://github.com/ana.lee/app"), "https://github.com/[email]/app");
  assert.equal(s("Author: Ana Lee <ana.lee@example.com>"), "Author: [name] <[email]>");
  assert.equal(s("Signed-off-by: Ana Lee"), "Signed-off-by: [name]");
  assert.equal(s("anabel@Anas-MacBook-Pro ~ %"), "user@computer ~ %");
  assert.equal(s("Anabel and ANABEL stay"), "Anabel and ANABEL stay"); // case-sensitive
  assert.equal(s("Android Studio"), "Android Studio");                 // a common word is never a name
  const short = forSharing("npm run dev; const max = 5; MacBook Air", { ...ana, user: "dev", hosts: ["max", "Air"], mailbox: "pro", name: "Mac" });
  assert.equal(short, "npm run dev; const max = 5; MacBook Air");
});

test("object keys are masked like values", () => {
  const out = forSharing({ files: { "/Users/ana/code/plan.md": 1 }, headers: { "x-api-key sk-ant-api03-FAKEFAKEFAKEFAKE0123": 1 } }, ana) as any;
  assert.deepEqual(Object.keys(out.files), ["~/code/plan.md"]);
  assert.ok(!JSON.stringify(out).includes("FAKEFAKE"), JSON.stringify(out));
});
