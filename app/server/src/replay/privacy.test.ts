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
