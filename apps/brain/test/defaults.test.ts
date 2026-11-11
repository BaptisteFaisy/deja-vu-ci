/**
 * Guard: the runtime mirror of the engine defaults must stay identical to
 * `DEFAULT_SETTINGS` in `packages/core/src/types.ts`. The mirror exists only
 * because the engine package is not built when the app tests run; it is not
 * a second source of truth.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as ENGINE_DEFAULTS } from '../../../packages/core/src/types';
import { DEFAULT_SETTINGS } from '../src/pure/defaults';

describe('DEFAULT_SETTINGS mirror', () => {
  it('is deep-equal to the engine table', () => {
    expect(DEFAULT_SETTINGS).toEqual(ENGINE_DEFAULTS);
  });
});
