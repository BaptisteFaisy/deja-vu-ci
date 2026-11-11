/**
 * Secret masking (§ 18 "Secrets").
 *
 * All patterns live in the `PATTERNS` table below (data, not duplicated code).
 * Each entry replaces its match with a stable neutral token `«[masqué:kind]»`
 * so that masking is idempotent: the tokens themselves never match any pattern.
 *
 * `maskSecrets` accepts optional `extraPatterns`: they are **appended** to the
 * defaults (an extra pattern never removes or reorders a default). An extra
 * pattern must not match the neutral tokens (it would break idempotence), and
 * its `kind` gives the token label.
 */

export interface MaskResult {
  text: string;
  masked: number;
  kinds: string[];
}

export interface MaskPattern {
  kind: string;
  re: RegExp;
  /** Optional extra validation of a match before replacing. */
  validate?: (match: string) => boolean;
}

export interface MaskOptions {
  /** Additional patterns appended to the defaults, in the given order. */
  extraPatterns?: MaskPattern[];
}

const TOKEN = (kind: string) => `«[masqué:${kind}]»`;

/** Luhn checksum: `true` when the digit string is a plausible card number. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (alternate) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/** Card number guard: Luhn checksum plus a leading industry digit/range. */
function isCardNumber(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  if (!luhnValid(digits)) return false;
  if (digits.startsWith('2')) return /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(digits);
  return /^[3456]/.test(digits);
}

/** Count of ASCII digits in a string (phone guard). */
function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= '0' && ch <= '9') n += 1;
  return n;
}

/** IBAN structural check (rearranged move + mod-97, ISO 13616). */
function isIban(value: string): boolean {
  if (value.length < 15 || value.length > 34) return false;
  const rearranged = (value.slice(4) + value.slice(0, 4)).toUpperCase();
  let num = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    num += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  let rest = 0;
  for (let i = 0; i < num.length; i += 7) {
    rest = (rest * 10 ** Math.min(7, num.length - i) + Number(num.slice(i, i + 7))) % 97;
  }
  return rest === 1;
}

/** Kinds emitted as neutral tokens; order defines substitution order. */
const PATTERNS: MaskPattern[] = [
  // PEM private key blocks (first: otherwise hex/blob rules would shred them).
  { kind: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  // Provider tokens (GitHub, Atlassian, npm, Slack).
  { kind: 'token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { kind: 'token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'token', re: /\bATATT3[A-Za-z0-9_\-=]{10,}\b/g },
  { kind: 'token', re: /\bAT(?:BP|CTT|ATT|OATT)[A-Za-z0-9_\-=]{10,}\b/g },
  { kind: 'token', re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { kind: 'token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // AWS access key ids.
  { kind: 'aws-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // JWT (three base64url segments).
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Authorization headers.
  { kind: 'token', re: /(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)[^\s"',;]{8,}/gi },
  // user:pass@ in URLs and connection strings.
  { kind: 'url-credentials', re: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s\/@:]+:[^\s\/@]+@/g },
  // Connection strings with an empty user (e.g. `redis://:pass@host`). Must
  // run before the email rule, which would otherwise eat `pass@host`.
  { kind: 'url-credentials', re: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/:)[^\s\/@]+@/g },
  // password/secret/api-key assignments.
  {
    kind: 'password',
    re: /\b(?:password|passwd|pwd|pass|secret|api[_-]?key|access[_-]?token)\b\s*[=:]\s*["']?([^\s"',;]{4,})/gi,
  },
  // Email addresses (after url-credentials so user:pass@host is not split).
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Long hex blobs (commit-ish or key material) — validator avoids dates-like runs.
  {
    kind: 'secret-blob',
    re: /\b[0-9a-fA-F]{33,}\b/g,
    validate: (m) => /[A-Fa-f]/.test(m) && /[0-9]/.test(m),
  },
  // Long base64-ish blobs that look like secrets (mixed case + digit).
  {
    kind: 'secret-blob',
    re: /\b[A-Za-z0-9+/]{33,120}={0,2}\b/g,
    validate: (m) => /[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m),
  },
  // GitLab personal access tokens.
  { kind: 'token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  // Google API keys (AIza…, 39 characters).
  { kind: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // Authorization with a quoted credential — the unquoted variant above stops
  // at the quote, so `Bearer "…"` / `Basic "…"` would otherwise leak.
  { kind: 'token', re: /\b(authorization\s*[:=]\s*(?:bearer|basic)\s+)["'][^"']{4,}["']/gi },
  // Password as a query parameter of a JDBC/connection string (`?password=…`).
  { kind: 'password', re: /([?&](?:password|passwd|pwd|pass|secret)=)[^&\s"'#]{1,}/gi },
  // IBAN (two letters, two check digits, alphanumeric tail, mod-97 check).
  { kind: 'iban', re: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g, validate: isIban },
  // Payment card numbers (Luhn + leading industry digit).
  { kind: 'card-number', re: /\b[0-9]{13,19}\b/g, validate: isCardNumber },
  // International phone numbers (explicit leading `+`, at least 7 digits).
  { kind: 'phone', re: /\+\d{1,3}[-. ()\d]{5,16}\b/g, validate: (m) => digitCount(m) >= 7 },
];

function applyOne(text: string, p: MaskPattern): { text: string; count: number } {
  let count = 0;
  const replaced = text.replace(p.re, (match: string, ...rest: unknown[]) => {
    if (p.validate && !p.validate(match)) return match;
    // Groups are unused; the last-but-one argument may be offset, not a group.
    if (rest.length >= 2 && typeof rest[rest.length - 2] === 'string') {
      // Capturing pattern: keep the prefix group(s), mask the tail.
      const prefix = rest.slice(0, rest.length - 2).filter((g): g is string => typeof g === 'string').join('');
      count += 1;
      return prefix + TOKEN(p.kind);
    }
    count += 1;
    return TOKEN(p.kind);
  });
  return { text: replaced, count };
}

export function maskSecrets(text: string, options: MaskOptions = {}): MaskResult {
  const effective = [...PATTERNS, ...(options.extraPatterns ?? [])];
  let out = text;
  let masked = 0;
  const kinds: string[] = [];
  for (const p of effective) {
    const { text: next, count } = applyOne(out, p);
    if (count > 0) {
      out = next;
      masked += count;
      if (!kinds.includes(p.kind)) kinds.push(p.kind);
    }
  }
  return { text: out, masked, kinds };
}

export function containsSecret(text: string): boolean {
  return PATTERNS.some((p) => {
    const found = text.match(p.re);
    if (!found) return false;
    return found.some((m) => !p.validate || p.validate(m));
  });
}
