import { describe, expect, it } from 'vitest';
import { familyOf, signatureKeys, signatureOf, signatureShort } from '../src/sign.js';
import type { ErrorBlock } from '../src/types.js';

function makeBlock(overrides: Partial<ErrorBlock> = {}): ErrorBlock {
  return {
    category: 'test',
    errorType: 'AssertionError',
    message: 'expected <NUM> to equal <NUM>',
    rawMessage: 'expected 4 to equal 5',
    frames: [
      { file: 'src/calc.ts', fn: 'add', line: 42, isProject: true },
      { file: 'test/calc.test.ts', fn: 'testAdd', line: 12, isProject: true },
    ],
    source: 'log',
    rawText: 'AssertionError: expected 4 to equal 5 at src/calc.ts:42',
    ...overrides,
  };
}

describe('signatureOf and familyOf', () => {
  it('returns a 16 hex character string', () => {
    const block = makeBlock();
    const sig = signatureOf(block);
    const fam = familyOf(block);
    expect(sig).toMatch(/^[0-9a-f]{16}$/);
    expect(fam).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces the same signature when only line numbers differ in frames', () => {
    const b1 = makeBlock({
      frames: [{ file: 'src/calc.ts', fn: 'add', line: 42, isProject: true }],
    });
    const b2 = makeBlock({
      frames: [{ file: 'src/calc.ts', fn: 'add', line: 999, isProject: true }],
    });
    expect(signatureOf(b1)).toBe(signatureOf(b2));
    expect(familyOf(b1)).toBe(familyOf(b2));
  });

  it('produces the same family even when frames differ', () => {
    const b1 = makeBlock({
      frames: [{ file: 'src/one.ts', fn: 'f1', line: 1, isProject: true }],
    });
    const b2 = makeBlock({
      frames: [{ file: 'src/two.ts', fn: 'f2', line: 2, isProject: true }],
    });
    expect(familyOf(b1)).toBe(familyOf(b2));
    expect(signatureOf(b1)).not.toBe(signatureOf(b2));
  });

  it('changes signature and family when category, type or message changes', () => {
    const base = makeBlock();
    const diffCat = makeBlock({ category: 'compile' });
    const diffType = makeBlock({ errorType: 'TypeError' });
    const diffMsg = makeBlock({ message: 'different message' });

    expect(signatureOf(diffCat)).not.toBe(signatureOf(base));
    expect(signatureOf(diffType)).not.toBe(signatureOf(base));
    expect(signatureOf(diffMsg)).not.toBe(signatureOf(base));
  });

  it('returns both keys via signatureKeys', () => {
    const block = makeBlock();
    const keys = signatureKeys(block);
    expect(keys.signature).toBe(signatureOf(block));
    expect(keys.family).toBe(familyOf(block));
  });
});

describe('signatureShort', () => {
  it('formats id as S-xxx with 3 decimal digits', () => {
    const tag = signatureShort('1a2b3c4d5e6f7a8b');
    expect(tag).toMatch(/^S-\d{3}$/);
  });

  it('is deterministic for the same signature', () => {
    expect(signatureShort('abcdef0123456789')).toBe(signatureShort('abcdef0123456789'));
  });
});
