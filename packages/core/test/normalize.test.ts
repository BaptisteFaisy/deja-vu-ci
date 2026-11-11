import { describe, expect, it } from 'vitest';
import { normalizeFrames, normalizeMessage, stripAnsi, TOKENS } from '../src/normalize.js';
import type { Frame } from '../src/types.js';

describe('stripAnsi', () => {
  it('removes ANSI color and style escape sequences', () => {
    const styled = '\u001b[31mFAIL\u001b[0m \u001b[1mtest/suite.ts\u001b[22m';
    expect(stripAnsi(styled)).toBe('FAIL test/suite.ts');
  });
});

describe('normalizeMessage', () => {
  it('normalizes ISO timestamps and durations', () => {
    const raw = '2026-11-11T03:50:00.123Z Error occurred after 123ms in step';
    const norm = normalizeMessage(raw);
    expect(norm).toContain(TOKENS.TS);
    expect(norm).toContain(TOKENS.DURATION);
    expect(norm).not.toContain('2026-11-11T03:50:00.123Z');
    expect(norm).not.toContain('123ms');
  });

  it('normalizes memory addresses, UUIDs and commit SHAs', () => {
    const raw = 'Segmentation fault at 0x7fff5fbff8e0 uuid: 123e4567-e89b-12d3-a456-426614174000 commit e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
    const norm = normalizeMessage(raw);
    expect(norm).toContain(TOKENS.ADDR);
    expect(norm).toContain(TOKENS.UUID);
    expect(norm).toContain(TOKENS.SHA);
  });

  it('normalizes temp paths and ports', () => {
    const raw = 'Failed to bind localhost:8080 writing to /tmp/scratch-4912/output.log';
    const norm = normalizeMessage(raw);
    expect(norm).toContain(TOKENS.PORT);
    expect(norm).toContain(TOKENS.TMPPATH);
  });

  it('normalizes line numbers and isolated numbers', () => {
    const raw = 'at src/index.ts:42:15 failed with 5 items remaining';
    const norm = normalizeMessage(raw);
    expect(norm).toContain(`:${TOKENS.LINE}`);
    expect(norm).toContain(TOKENS.NUM);
  });

  it('produces identical normalized text when only timestamps and line numbers change', () => {
    const log1 = '2026-11-11T01:00:00Z Error: failed at src/app.ts:12 with duration 500ms';
    const log2 = '2026-11-11T08:30:15Z Error: failed at src/app.ts:99 with duration 1200ms';
    expect(normalizeMessage(log1)).toBe(normalizeMessage(log2));
  });
});

describe('normalizeFrames', () => {
  it('keeps the first 5 project frames', () => {
    const frames: Frame[] = [
      { file: 'node_modules/vitest/dist/index.js', fn: 'run', line: 10, isProject: false },
      { file: 'src/index.ts', fn: 'main', line: 12, isProject: true },
      { file: 'src/a.ts', fn: 'fnA', line: 20, isProject: true },
      { file: 'src/b.ts', fn: 'fnB', line: 30, isProject: true },
      { file: 'src/c.ts', fn: 'fnC', line: 40, isProject: true },
      { file: 'src/d.ts', fn: 'fnD', line: 50, isProject: true },
      { file: 'src/e.ts', fn: 'fnE', line: 60, isProject: true },
    ];
    const normalized = normalizeFrames(frames);
    expect(normalized).toHaveLength(5);
    expect(normalized[0].file).toBe('src/index.ts');
    expect(normalized[4].file).toBe('src/d.ts');
    expect(normalized[0].line).toBe(12); // kept on the Frame object
  });

  it('falls back to all frames when no project frame is found', () => {
    const frames: Frame[] = [
      { file: 'node_modules/a.js', fn: 'a', line: 1, isProject: false },
      { file: 'node_modules/b.js', fn: 'b', line: 2, isProject: false },
    ];
    const normalized = normalizeFrames(frames);
    expect(normalized).toHaveLength(2);
  });
});
