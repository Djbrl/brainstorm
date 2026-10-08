// Owner: D. Redact API keys, tokens, passwords before anything is stored or sent.
const R = "[redacted]";

type Replacer = string | ((match: string, ...groups: string[]) => string);
const PATTERNS: [RegExp, Replacer][] = [
  // PEM private keys
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, R],
  // Provider keys
  [/\bsk-ant-[A-Za-z0-9_\-]{10,}/g, R],
  [/\bsk-(?:proj|live|test|svcacct|admin)-[A-Za-z0-9_\-]{16,}/g, R],
  [/\bsk-(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{16,}/g, R], // a bare sk- key has digits: not "sk-service-account-name"
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
  // Authorization headers
  [/\b(Bearer|bearer|BEARER|Basic|Token)\s+[A-Za-z0-9._~+\/=\-]{12,}/g, `$1 ${R}`],
  // Headers that carry credentials whatever the scheme: cookies, API key headers
  [/(\b(?:cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|proxy-authorization)[ \t]*:[ \t]*)(?!\[redacted\])[^\n]{6,}/gi, `$1${R}`],
  // Tokens in URLs: ?access_token=…&key=…
  [/([?&](?:access_token|refresh_token|id_token|token|api_?key|key|secret|client_secret|password|passwd|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|code)=)(?!\[redacted\])[^&\s#"'<>]{6,}/gi, `$1${R}`],
  // Credentials on a command line: curl -u user:pass, mysql -pPASS
  [/((?:^|\s)(?:-u|--user)[ \t]+['"]?[^\s:'"]{1,64}:)[^\s'"]{3,}/g, `$1${R}`],
  [/(\bmysql(?:dump|admin)?\b[^\n]{0,200}?[ \t]-p)(?=\S)[^\s'"]{3,}/g, `$1${R}`],
  // Connection-string passwords: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.\-]{1,15}:\/\/[^\s:@\/]{1,64}:)[^\s@\/]{1,128}@/gi, `$1${R}@`],
  // "password": "value"  /  password: 'value'
  [/(["']?\b[\w.\-]{0,40}(?:key|secret|token|passw(?:or)?d|pwd|credential)[\w.\-]{0,40}["']?\s{0,3}[:=]\s{0,3})(["'])(?!\[redacted\])[^"'\n]{3,200}\2/gi, `$1$2${R}$2`],
  // KEY=value (env style, unquoted)
  [/(\b[A-Z0-9_]{0,40}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Z0-9_]{0,40}[ \t]{0,3}[=:][ \t]{0,3})(?!["'\s]|\[redacted\])[^\s"'`,;()]{3,}(?=[\s,;]|$)/g, `$1${R}`],
  [/(--?(?:password|passwd|secret|token|api[_-]?key)[= ])(?!\[redacted\])[^\s"'`]{3,}/gi, `$1${R}`],
  // key: value / key = value, any case, unquoted (YAML, .ini, ~/.aws/credentials, .npmrc), when the value looks like
  // a secret (letters and digits, or long) and not like code (`token: string`, `apiKey = process.env.KEY`).
  [/(\b[\w.\-]{0,40}(?:key|secret|token|passw(?:or)?d|pwd|credential)[\w\-]{0,40}[ \t]{0,3}[=:][ \t]{0,3})(?![ \t"'`]|\[redacted\])([^\s"'`,;()<>{}\[\]]{8,200})(?=[\s,;]|$)/gi,
    (m: string, head: string, value: string) => (looksSecret(value) ? `${head}${R}` : m)],
];

/** A value worth hiding: has both letters and digits (hunter2hunter2, wJalrXUtnFEMI/K7MDENG), or is 32+ characters
 * without dots (a long random string), and isn't a code reference or a path. */
function looksSecret(v: string): boolean {
  if (/^(?:process\.|this\.|self\.|env\.|os\.|config\.|settings\.|import\.|\$|%|\/|~|https?:)/i.test(v)) return false;
  const letters = /[A-Za-z]/.test(v), digits = /\d/.test(v);
  return (letters && digits) || (v.length >= 32 && !v.includes("."));
}

export function maskSecrets(text: string): string {
  if (typeof text !== "string" || !text) return text;
  try {
    let out = text;
    for (const [re, rep] of PATTERNS) { re.lastIndex = 0; out = typeof rep === "string" ? out.replace(re, rep) : out.replace(re, rep as (m: string, ...g: string[]) => string); }
    return out;
  } catch {
    return text;
  }
}
