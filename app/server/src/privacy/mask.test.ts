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
  // The audit's realistic secret cases (second pass, mask-probe.cjs and mask-probe2.cjs)
  ["REDIS_URL=redis://:hunter2hunter2@cache.internal:6379", "hunter2hunter2"],
  ["redis://:hunter2hunter2@cache.internal:6379", "hunter2hunter2"],
  ["curl -X POST https://hooks.slack.com/services/T0FAKEEF1/B0FAKEEF2/fakefakefakefakefakefake", "fakefakefake"],
  ["https://discord.com/api/webhooks/123456789012345678/fakeFAKEfakeFAKEfakeFAKEfake_-0123456789", "fakeFAKEfake"],
  ["DB_PASS=hunter2hunter2", "hunter2hunter2"],
  ["SMTP_PASS=s3cr3tPw", "s3cr3tPw"],
  ["machine api.example.com login ana password hunter2hunter2", "hunter2hunter2"],
  ["machine api.example.com\n  login ana\n  password letmein\n", "letmein"],
  ["SENTRY_DSN=https://fa4e0123456789abcdef0123456789ab@o123456.ingest.sentry.io/1234567", "fa4e0123456789"],
  ["DATABASE_URL=postgres://app:p4ssw0rd@db.internal:5432/app", "p4ssw0rd"],
  ["OPENAI_API_KEY=sk-proj-fakefakefakefakefakefake0123456789", "fakefakefake"],
  ["JWT_SECRET=correcthorsebatterystaple", "correcthorse"],
  ['SESSION_SECRET="changeme-but-real-9f8e7d"', "changeme-but-real"],
  ["STRIPE_SECRET_KEY=sk_live_51HfakefakefakefakeFAKEFA", "sk_live_51H"],
  ["api_key=abcd1234efgh5678", "abcd1234efgh5678"],
  ["NEXTAUTH_SECRET=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA==", "Zm9vYmFy"],
  ["ADMIN_PASSWORD=letmeinplease", "letmeinplease"],
  ["      POSTGRES_PASSWORD: example-pass-2024", "example-pass-2024"],
  ["      - MYSQL_ROOT_PASSWORD=rootpw123", "rootpw123"],
  ["data:\n  password: cGFzc3dvcmQxMjM=\n  username: YWRtaW4=", "cGFzc3dvcmQxMjM"],
  ["stringData:\n  DB_PASSWORD: s3cr3t-value", "s3cr3t-value"],
  ["[default]\naws_access_key_id = AKIAFAKEFAKEFAKEFAKE\naws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYFAKEKEY", "wJalrXUtnFEMI"],
  ["aws_session_token = IQoJb3JpZ2luX2VjEJr//////////wEaCXVzLWVhc3QtMSJHMEUCIQ", "IQoJb3Jp"],
  ['curl -H "Authorization: Bearer abc123def456ghi789" https://api.example.com', "abc123def456"],
  ["curl -H 'X-Api-Key: 9f8e7d6c5b4a3210' https://api.example.com", "9f8e7d6c5b4a3210"],
  ["curl -u admin:hunter2hunter2 https://api.example.com", "hunter2hunter2"],
  ['curl --header="Authorization: token ghp_fakefakefakefakefakefake0123456789"', "ghp_fake"],
  ["mongodb+srv://user:Pa55word@cluster0.abcd.mongodb.net/db", "Pa55word"],
  ["amqp://guest:guestpass1@rabbit:5672/", "guestpass1"],
  ["jdbc:postgresql://db:5432/app?user=app&password=p4ssw0rd", "p4ssw0rd"],
  ["Server=tcp:db.example.com;Database=app;User Id=sa;Password=Str0ngP4ss;", "Str0ngP4ss"],
  ['{"access_token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakeFAKEfakeFAKEfake"}', "eyJhbGci"],
  ['{"user":"ana","password":"hunter2"}', "hunter2"],
  ['{"password":"abc"}', '"abc"'],
  ['"password": "correct horse battery staple"', "horse battery"],
  ["//registry.npmjs.org/:_authToken=npm_fakefakefakefakefakefake0123456789", "npm_fake"],
  ["pip install --index-url https://__token__:pypi-AgEIcHlwaS5vcmcCJDAwMDAwMDAwLTAwMDAtMDAwMC0wMDAw@upload.pypi.org/simple pkg", "pypi-AgEI"],
  ["export GITHUB_TOKEN=ghp_fakefakefakefakefakefake0123456789", "ghp_fake"],
  ["PGPASSWORD=hunter2hunter2 psql -h db -U app", "hunter2hunter2"],
  ["mysql -u root -phunter2hunter2 app", "hunter2hunter2"],
  ["https://x-access-token:ghs_fakefakefakefakefakefake01234@github.com/o/r.git", "ghs_fake"],
  ['"private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\n-----END PRIVATE KEY-----\\n"', "MIIEvQIB"],
  ["DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=abcd1234efgh5678ijkl9012mnop3456qrst7890uvwx==;EndpointSuffix=core.windows.net", "abcd1234efgh"],
  ["TWILIO_AUTH_TOKEN=0123456789abcdef0123456789abcdef", "0123456789abcdef"],
  ["client_secret: abcdefghijklmnopqrstuvwxyzabcdefgh", "abcdefghijklmnop"],
  ["password: correcthorse", "correcthorse"],
  ["db_password=letmein", "letmein"],
  ["ANTHROPIC_API_KEY=sk-ant-api03-fakefakefakefake", "sk-ant-api03"],
  // Authorization with any scheme, lowercase or not
  ['curl -H "Authorization: token 0123456789abcdef0123456789abcdef01234567" https://api.github.com/user', "0123456789abcdef"],
  ['curl -H "Authorization: ApiKey abcd1234efgh5678ijkl" https://es.example.com', "abcd1234efgh"],
  ['curl -H "Authorization: Bot MTIzNDU2Nzg5MDEyMzQ1Njc4.GabcDE.fakefakefakefakefakefake012345" https://discord.com/api', "MTIzNDU2"],
  ['curl -H "Authorization: Digest username=\\"a\\", response=\\"6629fae49393a05397450978507c4ef1\\""', "6629fae4"],
  ["Authorization: sk_live_shortish", "sk_live_shortish"],
  ['{"Authorization": "Bearer abc123def456ghi789"}', "abc123def456"],
  // .pgpass, docker, sshpass, long quoted values, YAML blocks, passwords holding an @
  ["db.example.com:5432:app:appuser:hunter2hunter2", "hunter2hunter2"],
  ['export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYFAKEKEY"', "wJalrXUtnFEMI"],
  ["PRIVATE-TOKEN: abcdef0123456789abcd", "abcdef0123456789abcd"],
  ["docker login -u ana -p hunter2hunter2 registry.example.com", "hunter2hunter2"],
  ["docker login --password=hunter2hunter2 registry.example.com", "hunter2hunter2"],
  ["sshpass -p hunter2hunter2 ssh ana@host", "hunter2hunter2"],
  ["sshpass -p 'letmein' ssh ana@host", "letmein"],
  [`"password": "${"x".repeat(250)}"`, "xxxxxxxxxx"],
  ["secret: |\n  multi-line-secret-value-123\n", "multi-line-secret"],
  ["ftp://ana:hunter2@ftp.example.com/", "hunter2"],
  ["postgres://ana:p@ss@db/app", "ss@db"],
  ["PASSWORD=p@ss word", "p@ss"],
  ['{\\"password\\":\\"hunter2\\"}', "hunter2"],
  ['{"auths":{"https://index.docker.io/v1/":{"auth":"ZGVtbzpwYXNzd29yZA=="}}}', "ZGVtbzpw"],
];

// Code, prose and ordinary values that must come out exactly as they went in.
const KEEP: string[] = [
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
  // The audit's must-stay cases (second pass, mask-probe.cjs)
  '"keyword": "search term"',
  '"tokenizer": "gpt2-base"',
  '"maxTokens": "4096"',
  '"foreignKey": "user_id"',
  "KEYCLOAK_URL=https://auth.example.com",
  "MAX_TOKENS=4096",
  "TOKENIZERS_PARALLELISM=false",
  "hotkey: ctrl+shift+1",
  "tokenizer: gpt2-base",
  "Token authentication is enabled",
  "Basic Authentication is used",
  "Set the cookie: it expires in a week",
  "GET /page?code=404abc",
  "const token = await getToken(user);",
  "type K = keyof typeof map;",
  "items.map((item) => ({ key: item.id1234, value }))",
  "id: { type: DataTypes.INTEGER, primaryKey: true }",
  '<Row key="row-12345" />',
  'const cacheKey = "user:42:profile";',
  'sortKey: "createdAt2"',
  '"input_tokens": 1234, "output_tokens": 567',
  "client.messages.create(model=m, max_tokens=1024)",
  '{"max_tokens": 1024}',
  'keyboardShortcut: "cmd+k1"',
  'monkeyPatch = "v2patch"',
  'passwordField: "input#pw1"',
  "animation-name: keyframes1;",
  "author: Ana Lee",
  'ssh-keygen -t ed25519 -C "ana@example"',
  "The tokenizer splits text into tokens: about 4 chars each.",
  "Use Bearer authentication everywhere",
  "commit 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
  "sha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "idempotency_key: 123e4567-e89b-12d3-a456-426614174000",
  '"integrity": "sha512-abc123DEF456ghi789"',
  't("auth.passwordTooShort1")',
  "SECRET_KEY=${SECRET_KEY}",
  "SECRET_KEY=$SECRET_KEY",
  'API_TOKEN="${API_TOKEN}"',
  'const key = "session:abc123"',
  // More code and prose
  "Authorization: required for this endpoint",
  "headers: { Authorization: `Bearer ${token}` }",
  "Authorization: 'Bearer ' + token",
  "x-api-key: ${API_KEY}",
  'nextPageToken: "CAoQAA"',
  'eos_token: "</s>"',
  'credentials: "include"',
  '"password": "Password"',
  '"forgotPassword": "Forgot password?"',
  '"password": "Mot de passe"',
  '"secret": "Use the vault."',
  "password = hashedPassword;",
  "const password = req.body.password;",
  "GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}",
  "bypass: true",
  "description: |\n  a text\n",
  "src/app.ts:12:5: error TS2322",
];

test("real-world secret formats are masked", () => {
  for (const [input, secret] of LEAKS) {
    const out = maskSecrets(input);
    assert.ok(out !== input && !out.includes(secret), `leaked: ${JSON.stringify(input)} → ${JSON.stringify(out)}`);
  }
});

test("ordinary code and text stay as they are", () => {
  for (const s of KEEP) assert.equal(maskSecrets(s), s, s);
});

test("only the secret goes: the rest of the line stays", () => {
  assert.equal(maskSecrets("curl 'https://api.example.com/v1/x' -H 'x-api-key: abcdef0123' -H 'accept: json' --data '{}'"),
    "curl 'https://api.example.com/v1/x' -H 'x-api-key: [redacted]' -H 'accept: json' --data '{}'");
  assert.equal(maskSecrets('curl -H "Authorization: token 0123456789abcdef0123456789abcdef01234567" https://api.github.com/user'),
    'curl -H "Authorization: token [redacted]" https://api.github.com/user');
  assert.equal(maskSecrets("postgres://ana:p@ss@db/app"), "postgres://ana:[redacted]@db/app");
  assert.equal(maskSecrets("DB_PASS=hunter2hunter2 # comment"), "DB_PASS=[redacted] # comment");
  assert.equal(maskSecrets("  key: |\n    abc\n  password: >-\n    hunter2hunter2\n    more\n  name: x\n"),
    "  key: |\n    abc\n  password: >-\n    [redacted]\n    [redacted]\n  name: x\n");
});

test("still masked once (no double markers)", () => {
  assert.equal(maskSecrets("Authorization: Bearer FAKEtokenFAKEtoken1234"), "Authorization: Bearer [redacted]");
  assert.equal(maskSecrets(maskSecrets("password: hunter2hunter2")), "password: [redacted]");
  for (const [input] of LEAKS) {
    const once = maskSecrets(input);
    assert.equal(maskSecrets(once), once, `not idempotent: ${JSON.stringify(input)}`);
  }
  // A header value that starts with "[": the guard sits after the spaces, so a second pass keeps the space.
  const header = "\tx-api-key: [ access_token=abcdef123456";
  assert.equal(maskSecrets(maskSecrets(header)), maskSecrets(header));
});

test("a long run of sk- is masked in linear time", () => {
  maskSecrets("sk-".repeat(1000)); // warm up
  const run = "sk-".repeat(11_000); // 33 KB: a lookahead per "sk-" took seconds
  const t0 = performance.now();
  assert.equal(maskSecrets(run), run);
  assert.ok(performance.now() - t0 < 50, "sk- run took " + (performance.now() - t0) + " ms");
  assert.equal(maskSecrets(run + "9"), "[redacted]"); // a digit anywhere in the run makes it a key
});
