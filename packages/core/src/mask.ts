/**
 * Secret masking (§ 18 "Secrets").
 *
 * All patterns live in the `PATTERNS` table below (data, not duplicated code).
 * Each entry replaces its match with a stable neutral token `«[masqué:kind]»`
 * so that masking is idempotent: the tokens themselves never match any pattern.
 */

export interface MaskResult {
  text: string;
  masked: number;
  kinds: string[];
}

interface MaskPattern {
  kind: string;
  re: RegExp;
  /** Optional extra validation of a match before replacing. */
  validate?: (match: string) => boolean;
}

const TOKEN = (kind: string) => `«[masqué:${kind}]»`;

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

export function maskSecrets(text: string): MaskResult {
  let out = text;
  let masked = 0;
  const kinds: string[] = [];
  for (const p of PATTERNS) {
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
