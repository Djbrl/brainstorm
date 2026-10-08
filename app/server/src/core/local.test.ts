import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalWrite } from "./local";

test("reads always pass", () => {
  assert.equal(isLocalWrite("GET", undefined, "https://evil.example"), true);
  assert.equal(isLocalWrite("HEAD", undefined, undefined), true);
});

test("writes need JSON from this machine", () => {
  assert.equal(isLocalWrite("POST", "application/json", "http://localhost:4747"), true);
  assert.equal(isLocalWrite("POST", "application/json; charset=utf-8", "http://web.rundown.localhost:7331"), true);
  assert.equal(isLocalWrite("POST", "application/json", undefined), true); // the plugin's own scripts, curl
});

test("what another site can send is refused", () => {
  assert.equal(isLocalWrite("POST", "application/x-www-form-urlencoded", "https://evil.example"), false);
  assert.equal(isLocalWrite("POST", "text/plain", undefined), false);
  assert.equal(isLocalWrite("POST", "text/plain;x=application/json", "http://localhost:4747"), false);
  assert.equal(isLocalWrite("POST", undefined, undefined), false);
  assert.equal(isLocalWrite("POST", "application/json", "https://evil.example"), false);
  assert.equal(isLocalWrite("POST", "application/json", "null"), false);
  assert.equal(isLocalWrite("PUT", "application/jsonx", "http://localhost:4747"), false);
});
