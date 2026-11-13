/**
 * Tests of the effective target project (`src/pure/projectTarget.ts`).
 *
 * One rule, three answers: the operator's explicit choice primes; without one
 * the project of the screen is used; with neither there is no target and the
 * app must not write — it says why.
 */

import { describe, expect, it } from 'vitest';
import {
  createDecision,
  resolveProjectTarget,
  NO_PROJECT_REASON,
} from '../src/pure/projectTarget';

describe('resolveProjectTarget', () => {
  it('laisses the operator\'s explicit choice prime over the screen', () => {
    const target = resolveProjectTarget({ chosen: 'pay', screenProjectKey: 'other' });
    expect(target).toEqual({ projectKey: 'PAY', source: 'setting' });
  });

  it('uses the project of the screen when the register is empty', () => {
    const target = resolveProjectTarget({ chosen: '', screenProjectKey: 'pay' });
    expect(target).toEqual({ projectKey: 'PAY', source: 'screen' });
  });

  it('normalises the operator\'s choice: trimmed and upper case', () => {
    expect(resolveProjectTarget({ chosen: '  pay  ' }).projectKey).toBe('PAY');
  });

  it('answers « none » with a reason when there is no register and no screen', () => {
    const target = resolveProjectTarget({ chosen: '' });
    expect(target.source).toBe('none');
    expect(target.projectKey).toBe('');
    expect(target.reason).toBe(NO_PROJECT_REASON);
  });

  it('ignores a non-string register', () => {
    expect(resolveProjectTarget({ chosen: 7, screenProjectKey: 'pay' }).source).toBe('screen');
  });
});

describe('createDecision', () => {
  it('allows a create when a project was decided', () => {
    expect(createDecision({ projectKey: 'PAY', source: 'setting' })).toEqual({
      ok: true,
      projectKey: 'PAY',
    });
  });

  it('refuses a create with the why when no project was decided', () => {
    const refused = createDecision({ projectKey: '', source: 'none', reason: NO_PROJECT_REASON });
    expect(refused).toEqual({ ok: false, reason: NO_PROJECT_REASON });
  });
});