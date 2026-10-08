import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSecrets } from "./mask";

// Made-up values only. Each line must lose its secret part.
const LEAKS: [string, string][] = [
  ["password: hunter2hunter2", "hunter2hunter2"],
  ["aws_secret_access_key = FAKEwJalrXUtnFEMIK7MDENGbPxRfiCYFAKEKEY", "FAKEwJalr"],
  ["db_password=s3cretValue99", "s3cretValue99"],
  ["//registry.npmjs.org/:_authToken=npm_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5", "npm_aB3dE5"],
  ["api_key: abc123def456ghi789", "abc123def456"],
  ["STRIPE=sk_live_FAKE1234567890abcdefXYZ", "sk_live_FAKE"],
  ["rk_test_FAKE1234567890abcdefXYZ", "rk_test_FAKE"],
  ["SG.FAKEaaaaaaaaaaaaaaaa.FAKEbbbbbbbbbbbbbbbb", "SG.FAKE"],
  ["glpat-FAKEFAKEFAKEFAKEFAKE12", "glpat-FAKE"],
  ["hf_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12", "hf_FAKE"],
  ["Cookie: session=abc123; theme=dark", "session=abc123"],
  ["set-cookie: sid=FAKE987654; Path=/; HttpOnly", "sid=FAKE987654"],
  ["x-api-key: FAKEkey1234567890", "FAKEkey1234567890"],
  ["authorization: bearer FAKEtokenFAKEtoken1234", "FAKEtokenFAKEtoken1234"],
  ["GET https://api.example.com/v1/items?access_token=FAKE123456789&page=2", "FAKE123456789"],
  ["https://maps.example.com/api/js?key=AFAKEkeyFAKEkey123", "AFAKEkeyFAKEkey123"],
  ["https://bucket.s3.amazonaws.com/f?X-Amz-Signature=fa4e5f6a7b8c9d0e1f2a3b4c&X-Amz-Expires=300", "fa4e5f6a7b8c"],
  ["curl -u admin:hunter2hunter2 https://example.com", "hunter2hunter2"],
  ["mysql -h db -u root -pFakePass123 app", "FakePass123"],
  ["whsec_FAKEFAKEFAKEFAKEFAKEFAKE", "whsec_FAKE"],
  ["sk-proj-FAKEonlyLettersFAKEonlyLetters", "FAKEonly"],
];

test("real-world secret formats are masked", () => {
  for (const [input, secret] of LEAKS) assert.ok(!maskSecrets(input).includes(secret), `leaked: ${input} → ${maskSecrets(input)}`);
});

test("ordinary code and text stay as they are", () => {
  for (const s of [
    "password: string;",
    "token: string | null",
    "const apiKey = process.env.API_KEY;",
    "keyCount = 5",
    "monkey: banana",
    "sk-service-account-name-is-long",
    "secretary: Jane",
    "the basic configuration file",
    "token validation_function_name",
    "https://example.com/search?q=hello&page=2",
    "primaryKey: id",
  ]) assert.equal(maskSecrets(s), s, s);
});

test("still masked once (no double markers)", () => {
  assert.equal(maskSecrets("Authorization: Bearer FAKEtokenFAKEtoken1234"), "Authorization: Bearer [redacted]");
  assert.equal(maskSecrets(maskSecrets("password: hunter2hunter2")), "password: [redacted]");
});
