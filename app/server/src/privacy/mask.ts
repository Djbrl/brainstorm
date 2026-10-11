// Owner: D. Redact API keys, tokens, passwords before anything is stored or sent.
//
// Every rule runs in linear time on any input (test/regex-timing.test.cjs): an open-ended class is either bounded or
// can't fail after it has run (so the text it ran over is consumed, not scanned again from the next character), and
// rules that start anywhere in a word start only where the word starts. Masking twice gives the same text as once.
const R = "[redacted]";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Replacer = string | ((match: string, ...groups: any[]) => string);

// ---- What a value has to look like

/** Values that are code, a type or a placeholder, never a secret: `password: string`, `token = null`. */
const NOT_VALUES = new Set([
  "string", "str", "number", "int", "integer", "float", "double", "bool", "boolean", "object", "any", "unknown", "null",
  "nil", "none", "undefined", "true", "false", "yes", "off", "void", "never", "optional", "required", "bytes", "text",
  "char", "list", "dict", "array", "uuid", "date", "function", "enabled", "disabled", "hidden", "redacted", "masked",
  "empty", "default", "env", "inherit", "include", "omit", "secret", "secrets", "password", "token", "tokens", "key",
  "auth", "passwd", "credential", "credentials", "await", "async", "new", "this", "self", "return",
]);
/** A reference, not a value: an environment variable, a code path, a file, a URL, a template. */
const REFERENCE = /^(?:process\.|this\.|self\.|env\.|os\.|config\.|settings\.|import\.|\$|%|\/|~|\.\.?\/|https?:|<|\{\{)/i;

/** A value that reads like a random string: letters and digits, base64 padding or slashes, internal capitals, or long. */
function looksRandom(v: string): boolean {
  return (/\d/.test(v) && /[A-Za-z]/.test(v)) || /[+\/=]/.test(v) || v.length >= 32 || /[a-z][A-Z]|[A-Z]{2}[a-z]/.test(v);
}

/** A value after a secret key name worth hiding (hunter2hunter2, wJalrXUtnFEMI/K7MDENG, correcthorse on its own line),
 * and not code (`token: string`, `apiKey = process.env.KEY`, `password = hashedPassword;`). */
function secretValue(v: string, lastWord: string, wholeValue: boolean, envStyle: boolean, quoted = false): boolean {
  if (v.length < 3 || REFERENCE.test(v)) return false;
  const lower = v.toLowerCase();
  if (NOT_VALUES.has(lower) || lower === lastWord) return false;
  const letters = /[A-Za-z]/.test(v), digits = /\d/.test(v);
  if (letters && digits) return true;
  if (v.length >= 32 && !v.includes(".")) return true;
  if (!letters) return digits && v.length >= 4;     // a PIN or a numeric password
  // Letters only (letmein, correcthorse): a password when it stands on its own, not when it reads like code.
  if (v.includes(".")) return false;                 // req.body.password
  if (!envStyle && !quoted && /[a-z][A-Z]/.test(v)) return false; // password = hashedPassword: an identifier
  return wholeValue || envStyle;
}

// ---- Which key names hold secrets

/** Words before `token` that make it a cursor or a tokenizer's piece, not a credential (nextPageToken, eos_token). */
const NOT_SECRET_TOKEN = /^(?:page|next|nextpage|prev|previous|continuation|cursor|sync|cancellation|cancel|max|min|input|output|total|prompt|completion|lexer|eos|bos|pad|unk|sep|cls|mask|special|start|end|stop|num|count)$/;
/** Words before `key` that make it a credential (api_key, AccountKey, aws_secret_access_key). A bare key, a cacheKey or
 * a sortKey is not. */
const SECRET_KEY_KINDS = /^(?:api|access|secret|private|account|master|signing|sign|encryption|encrypt|client|license|licence|auth|app|consumer|subscription|sas|shared|storage|service|admin|root|deploy|webhook|hmac|jwt|session|ssh|gpg|pgp|crypto|cipher|aes|rsa|server|write|publish|upload|mgmt|management|primary|secondary)$/;
const SECRET_WORD = /^(?:[a-z]*(?:password|passwd|passphrase|secret)|pass|pwd|credential|apikey|accesskey|secretkey|privatekey|authkey)$/;

/** The parts of a key name: "aws_secret_access_key" → aws, secret, access, key; "apiKey" → api, key. */
function nameParts(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").split(/[\s._\-]+/).filter(Boolean).map((p) => p.toLowerCase());
}

/** The secret word a key name ends with (password, token, key...), or null. The word has to be the last part of the
 * name: "keyword", "tokenizer", KEYCLOAK_URL, MAX_TOKENS, monkeyPatch and passwordField are not secrets. */
function secretName(name: string): string | null {
  const parts = nameParts(name);
  const last = parts[parts.length - 1], before = parts[parts.length - 2] ?? "";
  if (!last) return null;
  if (SECRET_WORD.test(last)) return last;
  if (last.endsWith("token")) {
    const kind = last === "token" ? before : last.slice(0, -5);
    return NOT_SECRET_TOKEN.test(kind) ? null : last;
  }
  if (last === "key") {
    // In an environment file every *_KEY is a secret; in code only an api, access, secret... key is.
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_KEY$/.test(name)) return last;
    return SECRET_KEY_KINDS.test(before) ? last : null;
  }
  if (last === "auth") return last; // docker's config.json: "auth": "<base64>", value checked like any
  return null;
}

const UNQUOTED_END = /[ \t]*[;,]?[ \t]*(?:\r?\n|$)/y;

/** key = value, key: "value", "key": "value" (JSON, YAML, .env, .ini, code). */
function keyValue(m: string, head: string, name: string, open: string | undefined, quoted: string | undefined, close: string | undefined, bare: string | undefined, offset: number, all: string): string {
  const word = secretName(name);
  if (!word) return m;
  if (quoted !== undefined) {
    if (quoted === R) return m;
    if (/\s/.test(quoted)) {
      // With a space, a passphrase ("correct horse battery staple") or a label or sentence ("Forgot password?",
      // "Mot de passe"): a passphrase is a few lowercase words under a password or secret key.
      return /^(?:[a-z]*(?:password|passwd|passphrase|secret)|pass|pwd)$/.test(word) && /^[a-z0-9\-_]+(?: [a-z0-9\-_]+){1,7}$/.test(quoted)
        && !/password|passwd|secret|token|\bkey\b/.test(quoted) ? `${head}${open}${R}${close}` : m;
    }
    if (!secretValue(quoted.replace(/\\(.)/g, "$1"), word, true, false, true)) return m;
    return `${head}${open}${R}${close}`;
  }
  if (bare === undefined) return m;
  UNQUOTED_END.lastIndex = offset + m.length;
  const envStyle = /^[A-Z][A-Z0-9_]*$/.test(name) && /^[A-Z0-9_]+=$/.test(head.trimStart());
  return secretValue(bare, word, UNQUOTED_END.test(all), envStyle) ? `${head}${R}` : m;
}

const AUTH_SCHEMES = /^(?:bearer|basic|token|apikey|api-key|bot|digest|negotiate|ntlm|hoba|mutual|dpop|jwt|oauth|key|sso|aws4-hmac-sha256|gitlab|splunk|sharedkey|sharedaccesssignature)$/i;

/** A YAML block scalar under a secret key (secret: |, then lines indented deeper than the key): every line hidden. */
function blockValue(m: string, _indent: string, name: string, lines: string): string {
  if (!secretName(name)) return m;
  const masked = lines.replace(/^([ \t]+)(\S[^\n]*?)(\r?)$/gm, (l: string, lead: string, body: string, cr: string) => (body === R ? l : `${lead}${R}${cr}`));
  return m.slice(0, m.length - lines.length) + masked;
}

/** Authorization: <scheme> <credentials>, whatever the scheme (Bearer, token, ApiKey, Bot, Digest, Basic). */
function authorization(m: string, head: string, value: string): string {
  const scheme = /^([A-Za-z][\w\-]{0,30})[ \t]+(.+)$/.exec(value);
  if (scheme) {
    const [, word, rest] = scheme;
    if (rest.startsWith(R) || /^\$|^\{\{/.test(rest)) return m;
    // Digest and AWS4-HMAC carry key=value pairs: hide them all. Other schemes carry one token: hide it, keep the rest.
    if (/=/.test(rest) && /,/.test(rest)) return `${head}${word} ${R}`;
    const token = /^\S+/.exec(rest)![0];
    // A known scheme is followed by its credentials; any other word may be prose ("Authorization: required for...").
    if (token.length < 3 || (!AUTH_SCHEMES.test(word) && !looksRandom(token))) return m;
    return `${head}${word} ${R}${rest.slice(token.length)}`;
  }
  const token = /^\S+/.exec(value)?.[0] ?? "";
  if (token.startsWith(R) || REFERENCE.test(token) || token.length < 8 || NOT_VALUES.has(token.toLowerCase())) return m;
  if (!looksRandom(token) && !/[_\-]/.test(token)) return m;
  return `${head}${R}${value.slice(token.length)}`;
}

/** Headers that are credentials whatever they hold: cookies (name=value pairs), API key headers. */
function credentialHeader(m: string, head: string, name: string, value: string): string {
  if (/cookie/i.test(name) && !value.includes("=")) return m; // "Set the cookie: it expires in a week"
  if (REFERENCE.test(value)) return m;
  return `${head}${R}`;
}

const PATTERNS: [RegExp, Replacer][] = [
  // PEM private keys
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, R],
  // Provider keys
  [/\bsk-ant-[A-Za-z0-9_\-]{10,}/g, R],
  [/\bsk-(?:proj|live|test|svcacct|admin)-[A-Za-z0-9_\-]{16,}/g, R],
  // A bare sk- key has digits: not "sk-service-account-name". The digit is checked on the match, not by a lookahead:
  // a lookahead re-scans the rest of the run from every "sk-" in it (sk-sk-sk-..., quadratic).
  [/\bsk-[A-Za-z0-9_\-]{16,}/g, (m: string) => (/\d/.test(m) ? R : m)],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, R],        // Stripe secret and restricted keys
  [/\bwhsec_[A-Za-z0-9+\/=]{20,}/g, R],                      // webhook signing secrets
  [/\bglpat-[A-Za-z0-9_\-]{20,}/g, R],                        // GitLab
  [/\bhf_[A-Za-z0-9]{30,}/g, R],                              // Hugging Face
  [/\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}/g, R],     // SendGrid
  [/\bnpm_[A-Za-z0-9]{30,}/g, R],                             // npm
  [/\bpypi-[A-Za-z0-9_\-]{40,}/g, R],                         // PyPI
  [/\bdop_v1_[a-f0-9]{40,}/g, R],                             // DigitalOcean
  [/\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g, R],             // Shopify
  [/\bya29\.[A-Za-z0-9_\-]{20,}/g, R],                        // Google OAuth access tokens
  [/\bGOCSPX-[A-Za-z0-9_\-]{20,}/g, R],                        // Google OAuth client secrets
  [/\bnvapi-[A-Za-z0-9_\-]{10,}/g, R],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, R],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R],
  [/\bxapp-[A-Za-z0-9-]{10,}/g, R],
  [/\bAIza[0-9A-Za-z_\-]{30,}/g, R],
  // JWTs
  [/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, R],
  // Webhook URLs: the path is the secret
  [/(\bhooks\.slack\.com\/(?:services|workflows|triggers)\/)(?!\[redacted\])[A-Za-z0-9_\/\-]{8,}/g, `$1${R}`],
  [/(\bdiscord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/)(?!\[redacted\])[A-Za-z0-9_\-]{20,}/g, `$1${R}`],
  // Connection-string passwords: scheme://user:pass@host, the user may be empty (redis://:pass@host), the password may
  // hold an @ (it runs to the last @ before the host)
  [/(\b[a-z][a-z0-9+.\-]{1,15}:\/\/[^\s:@\/]{0,64}:)(?!\[redacted\]@)[^\s\/]{1,128}@/gi, `$1${R}@`],
  // A key as the whole user part: Sentry DSNs (https://<key>@o1.ingest.sentry.io/1), https://<token>@host
  [/(\b[a-z][a-z0-9+.\-]{1,15}:\/\/)([A-Za-z0-9_\-]{20,128})@/gi, (m: string, head: string, key: string) => (/\d/.test(key) && /[A-Za-z]/.test(key) ? `${head}${R}@` : m)],
  // Authorization headers, whatever the scheme; the value ends at its closing quote (a curl line keeps its tail)
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["'`]?)((?:[^"'`\n\\]|\\[^\n]){3,2000})/gi, authorization],
  // Headers that carry credentials whatever the scheme: cookies, API key headers
  [/(\b(cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|proxy-authorization)["']?[ \t]*:[ \t]*(?![ \t]|\[redacted\]))((?:[^"'`\n\\]|\\[^\n]){6,4000})/gi, credentialHeader],
  // Bearer and Basic credentials outside a header, when the word after them looks like a token ("Use Bearer authentication" stays)
  [/(\b(?:Bearer|bearer|BEARER|Basic|Token)[ \t]+)([A-Za-z0-9._~+\/=\-]{12,})/g, (m: string, head: string, v: string) => (looksRandom(v) ? `${head}${R}` : m)],
  // Tokens in URLs: ?access_token=…&key=…, and an OAuth ?code= when it's long enough to be one (not ?code=404)
  [/([?&](?:access_token|refresh_token|id_token|token|api_?key|key|secret|client_secret|password|passwd|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token)=)(?!\[redacted\])[^&\s#"'<>]{6,}/gi, `$1${R}`],
  [/([?&]code=)(?!\[redacted\])[^&\s#"'<>]{20,}/g, `$1${R}`],
  // Credentials on a command line: curl -u user:pass, mysql -pPASS, docker login -p, sshpass -p
  [/((?:^|\s)(?:-u|--user)[ \t]+['"]?[^\s:'"]{1,64}:)[^\s'"]{3,}/g, `$1${R}`],
  [/(\bmysql(?:dump|admin)?\b[^\n]{0,200}?[ \t]-p)(?=\S)(?!\[redacted\])[^\s'"]{3,}/g, `$1${R}`],
  [/(\bdocker[ \t]+login\b[^\n]{0,200}?[ \t](?:-p|--password)(?:[ \t]+|=)['"]?)(?![ \t]|\[redacted\])[^\s'"]{3,}/g, `$1${R}`],
  [/(\bsshpass[ \t]+(?:-[a-oq-zA-Z]\S{0,200}[ \t]+){0,3}-p[ \t]*['"]?)(?![ \t]|\[redacted\])[^\s'"]{3,}/g, `$1${R}`],
  [/(--?(?:password|passwd|secret|token|api[_-]?key)[= ])(?!\[redacted\])[^\s"'`]{3,}/gi, `$1${R}`],
  // ~/.netrc: machine host login ana password pw, on one line or one per line
  [/(\b(?:machine[ \t]+\S{1,253}|default)(?:[ \t]+(?:login|account)[ \t]+\S{1,253}){0,2}[ \t]+password[ \t]+)(?![ \t]|\[redacted\])\S{1,200}/g, `$1${R}`],
  [/^([ \t]*password[ \t]+)(?!\[redacted\])\S{1,200}(?=[ \t]*$)/gm, `$1${R}`],
  // ~/.pgpass: host:port:database:user:password
  [/^([^:\s]{1,253}:(?:\d{1,5}|\*):[^:\s]{1,253}:[^:\s]{1,253}:)(?!\[redacted\])\S{1,200}$/gm, `$1${R}`],
  [/^([ \t]*)([A-Za-z_][\w.\-]{0,60})[ \t]{0,3}:[ \t]{0,3}[|>][+\-]?[ \t]*\r?\n((?:\1[ \t]+\S[^\n]{0,500}(?:\n|$)){1,50})/gm, blockValue],
  // key = value, key: "value", "key": "value", when the key name ends with a secret word and the value looks like one.
  // The name starts where a word starts (not inside one), so each start costs at most the name and value lengths.
  [/((?<![\w.\-])(?:\\?["'])?([A-Za-z_][\w.\-]{0,60})(?:\\?["'])?[ \t]{0,3}(?::=|[:=])[ \t]{0,3})(?:(\\?["'])((?:[^"'\n\\]|\\[^"'\n]){1,1000})(\\?["'])|([^\s"'`,;:=()<>{}\[\]\\]{1,200}={0,3})(?=[\s,;"'`)}\]\\]|$))/g, keyValue],
];

export function maskSecrets(text: string): string {
  if (typeof text !== "string" || !text) return text;
  try {
    let out = text;
    for (const [re, rep] of PATTERNS) { re.lastIndex = 0; out = typeof rep === "string" ? out.replace(re, rep) : out.replace(re, rep); }
    return out;
  } catch {
    return text;
  }
}
