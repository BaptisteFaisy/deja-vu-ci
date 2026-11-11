import { describe, expect, it } from 'vitest';
import { maskSecrets } from '../src/mask.js';

/**
 * Extended masking: the new default patterns added by the hardening lot, and
 * the `extraPatterns` option. Every secret-looking literal is **built at
 * runtime** so that no real-looking credential is ever committed.
 */

const IBAN = ['GB', '82', 'WEST', '1234', '5698', '7654', '32'].join('');
const CARD = '4' + '1'.repeat(15); // 4111… — Luhn-valid test card.
const CARD_BAD = '4' + '1'.repeat(14) + '2'; // same shape, Luhn-invalid.
const PHONE = ['+', '33', '6', '12', '34', '56', '78'].join('');
const GITLAB = 'glpat-' + 'a1'.repeat(10);
const GOOGLE = 'AIza' + 'a'.repeat(10) + '-' + 'b'.repeat(24);
const AWS_ASIA = 'ASIA' + 'ABCDEFGHIJKLMNOP';
const AUTH_TOKEN = 'tok' + 'en'.repeat(4);

function masked(text: string): string {
  return maskSecrets(text).text;
}

describe('extended masking — new default patterns', () => {
  it('masks an IBAN and leaves a near-miss alone', () => {
    expect(masked(`transfer to ${IBAN} failed`)).toContain('«[masqué:iban]»');
    expect(masked(`transfer to ${IBAN} failed`)).not.toContain(IBAN);
    // A random uppercase run that is not a valid IBAN is left alone.
    expect(masked('code GB82WEST12345698765433 ok')).toContain('GB82WEST12345698765433');
  });

  it('masks a Luhn-valid card number and not an invalid one', () => {
    expect(masked(`card ${CARD} declined`)).toContain('«[masqué:card-number]»');
    expect(masked(`card ${CARD} declined`)).not.toContain(CARD);
    expect(masked(`card ${CARD_BAD} declined`)).toContain(CARD_BAD);
  });

  it('masks an international phone number', () => {
    expect(masked(`call ${PHONE} now`)).toContain('«[masqué:phone]»');
    expect(masked(`call ${PHONE} now`)).not.toContain(PHONE);
  });

  it('masks a quoted Authorization credential (Basic/Bearer)', () => {
    expect(masked(`Authorization: Bearer "${AUTH_TOKEN}"`)).toContain('«[masqué:token]»');
    expect(masked(`Authorization: Bearer "${AUTH_TOKEN}"`)).not.toContain(AUTH_TOKEN);
    expect(masked(`authorization: basic '${AUTH_TOKEN}'`)).not.toContain(AUTH_TOKEN);
  });

  it('masks a GitLab personal access token', () => {
    expect(masked(`token ${GITLAB} rejected`)).toContain('«[masqué:token]»');
    expect(masked(`token ${GITLAB} rejected`)).not.toContain(GITLAB);
  });

  it('masks a Google API key', () => {
    expect(masked(`key ${GOOGLE} invalid`)).toContain('«[masqué:google-key]»');
    expect(masked(`key ${GOOGLE} invalid`)).not.toContain(GOOGLE);
  });

  it('masks an AWS ASIA temporary access key id', () => {
    expect(masked(`aws ${AWS_ASIA} expired`)).toContain('«[masqué:aws-key]»');
    expect(masked(`aws ${AWS_ASIA} expired`)).not.toContain(AWS_ASIA);
  });

  it('masks a Redis connection string with an empty user', () => {
    const url = `redis://:${'pw'.repeat(3)}@cache.internal:6379/0`;
    const out = masked(`connect ${url}`);
    expect(out).toContain('«[masqué:url-credentials]»');
    expect(out).not.toContain('pwpwpw');
  });

  it('masks a Mongo connection string with user:pass', () => {
    const url = `mongodb://svc:${'pw'.repeat(3)}@db.internal:27017/app`;
    const out = masked(`connect ${url}`);
    expect(out).toContain('«[masqué:url-credentials]»');
    expect(out).not.toContain('pwpwpw');
  });

  it('masks a JDBC connection string password query parameter', () => {
    const url = 'jdbc:mysql://db:3306/app?user=svc&password=abc';
    const out = masked(`connect ${url}`);
    expect(out).toContain('«[masqué:password]»');
    expect(out).not.toContain('password=abc');
  });
});

describe('extended masking — idempotence and extraPatterns', () => {
  it('is idempotent for every new pattern', () => {
    const raw = `${IBAN} ${CARD} ${PHONE} ${GITLAB} ${GOOGLE} ${AWS_ASIA}`;
    const first = maskSecrets(raw);
    const second = maskSecrets(first.text);
    expect(second.text).toBe(first.text);
    expect(second.masked).toBe(0);
  });

  it('extraPatterns add to the defaults without removing them', () => {
    const extra = { kind: 'acme-key', re: /\bACME-[A-Z0-9]{8}\b/g };
    const text = `contact dev@acme.test with ACME-12AB34CD and ${CARD}`;
    const res = maskSecrets(text, { extraPatterns: [extra] });
    // The default email pattern still applies…
    expect(res.text).toContain('«[masqué:email]»');
    // …the default card pattern still applies…
    expect(res.text).toContain('«[masqué:card-number]»');
    // …and the extra pattern applies too.
    expect(res.text).toContain('«[masqué:acme-key]»');
    expect(res.text).not.toContain('ACME-12AB34CD');
  });

  it('extraPatterns keep masking idempotent', () => {
    const extra = { kind: 'acme-key', re: /\bACME-[A-Z0-9]{8}\b/g };
    const first = maskSecrets('key ACME-12AB34CD here', { extraPatterns: [extra] });
    const second = maskSecrets(first.text, { extraPatterns: [extra] });
    expect(second.text).toBe(first.text);
    expect(second.masked).toBe(0);
  });

  it('defaults are unchanged when no options are passed', () => {
    expect(maskSecrets('no secret here').masked).toBe(0);
    expect(masked('clean log line')).toBe('clean log line');
  });
});
