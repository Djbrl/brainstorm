// Owner: D. Redact API keys, tokens, passwords before anything is stored or sent.
const R = "[redacted]";

const PATTERNS: [RegExp, string][] = [
  // PEM private keys
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, R],
  // Provider keys
  [/\bsk-ant-[A-Za-z0-9_\-]{10,}/g, R],
  [/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_\-]{16,}/g, R],
  [/\bnvapi-[A-Za-z0-9_\-]{10,}/g, R],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}/g, R],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R],
  [/\bAIza[0-9A-Za-z_\-]{30,}/g, R],
  // JWTs
  [/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, R],
  // Authorization headers
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+\/=\-]{12,}/g, `$1 ${R}`],
  // Connection-string passwords: scheme://user:pass@host
  [/(\b[a-z][a-z0-9+.\-]{1,15}:\/\/[^\s:@\/]{1,64}:)[^\s@\/]{1,128}@/gi, `$1${R}@`],
  // "password": "value"  /  password: 'value'
  [/(["']?\b[\w.\-]{0,40}(?:key|secret|token|passw(?:or)?d|pwd|credential)[\w.\-]{0,40}["']?\s{0,3}[:=]\s{0,3})(["'])(?!\[redacted\])[^"'\n]{3,200}\2/gi, `$1$2${R}$2`],
  // KEY=value (env style, unquoted)
  [/(\b[A-Z0-9_]{0,40}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Z0-9_]{0,40}[ \t]{0,3}[=:][ \t]{0,3})(?!["'\s]|\[redacted\])[^\s"'`,;()]{3,}(?=[\s,;]|$)/g, `$1${R}`],
  [/(--?(?:password|passwd|secret|token|api[_-]?key)[= ])(?!\[redacted\])[^\s"'`]{3,}/gi, `$1${R}`],
];

export function maskSecrets(text: string): string {
  if (typeof text !== "string" || !text) return text;
  try {
    let out = text;
    for (const [re, rep] of PATTERNS) { re.lastIndex = 0; out = out.replace(re, rep); }
    return out;
  } catch {
    return text;
  }
}
