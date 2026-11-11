import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNIPPET_CHARS,
  excerptFingerprint,
  minimizeExcerpt,
} from '../src/minimize.js';

/**
 * Data minimization: the excerpt is reduced to the strict minimum of the
 * chosen policy, secrets are always masked, and the fingerprint is stable
 * across policies. Secrets are built at runtime (no real-looking literal).
 */

const SECRET_LINE = `Authorization: Bearer ${'tok' + 'en'.repeat(4)}`;
const RAW = `step failed\n${SECRET_LINE}\nassertion error at line 42`;

describe('minimizeExcerpt', () => {
  it('hash-only keeps nothing but the fingerprint', () => {
    const out = minimizeExcerpt({ text: RAW }, 'hash-only');
    expect(out.text).toBeUndefined();
    expect(out.bytes).toBe(0);
    expect(out.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(out.masked).toBe(false);
  });

  it('masked-snippet keeps a masked, truncated excerpt', () => {
    const long = RAW + 'x'.repeat(2000);
    const out = minimizeExcerpt({ text: long }, 'masked-snippet', { maxChars: 64 });
    expect(out.text).toBeDefined();
    expect(out.text!.length).toBe(64);
    expect(out.truncated).toBe(true);
    expect(out.masked).toBe(true);
    expect(out.text).not.toContain('tokenen');
  });

  it('full keeps the whole masked excerpt without truncation', () => {
    const out = minimizeExcerpt({ text: RAW }, 'full');
    expect(out.truncated).toBe(false);
    expect(out.masked).toBe(true);
    expect(out.text).toContain('assertion error');
    expect(out.text).not.toContain('tokenen');
    expect(out.bytes).toBe(Buffer.byteLength(out.text!, 'utf8'));
  });

  it('masks secrets under every text-bearing policy', () => {
    for (const policy of ['masked-snippet', 'full'] as const) {
      const out = minimizeExcerpt({ text: RAW }, policy);
      expect(out.text).not.toContain('Bearer tok');
      expect(out.text).toContain('«[masqué:');
    }
  });

  it('defaults to masked-snippet and the default budget', () => {
    const out = minimizeExcerpt({ text: RAW });
    expect(out.text).toBeDefined();
    expect(out.truncated).toBe(false); // RAW is shorter than the default budget
    expect(DEFAULT_SNIPPET_CHARS).toBeGreaterThan(RAW.length);
  });

  it('yields the same fingerprint for the same raw text across policies', () => {
    const a = minimizeExcerpt({ text: RAW }, 'hash-only');
    const b = minimizeExcerpt({ text: RAW }, 'masked-snippet');
    const c = minimizeExcerpt({ text: RAW }, 'full');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(b.fingerprint).toBe(c.fingerprint);
    expect(a.fingerprint).toBe(excerptFingerprint(RAW));
  });

  it('honours a caller-provided fingerprint', () => {
    const out = minimizeExcerpt({ text: RAW, fingerprint: 'deadbeefcafe1234' }, 'hash-only');
    expect(out.fingerprint).toBe('deadbeefcafe1234');
  });

  it('is pure: it never mutates its input', () => {
    const input = { text: RAW };
    const snapshot = JSON.stringify(input);
    minimizeExcerpt(input, 'full');
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
