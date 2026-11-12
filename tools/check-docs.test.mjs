/**
 * Tests of tools/check-docs.mjs.
 *
 * The fixtures live in `os.tmpdir()` (nothing is written inside the
 * repository); the last test runs the checker on the real tracked
 * documentation, so a broken link cannot be merged unnoticed.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { anchorsOf, checkDocs, linksOf, slugify } from './check-docs.mjs';

/** A merge marker built at runtime: this file must never contain one. */
const MARKER = '<'.repeat(7);

/** Builds a documentation tree in a temporary directory. */
function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'dv-docs-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(root, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { root, files: Object.keys(files), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('slugify and anchorsOf', () => {
  it('slugifies headings the GitHub way', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify("What's new in v2?")).toBe('whats-new-in-v2');
    expect(slugify('  Spaces   everywhere  ')).toBe('spaces-everywhere');
  });

  it('numbers duplicate headings', () => {
    const anchors = anchorsOf('# Setup\n\ntext\n\n# Setup\n\nmore\n');
    expect(anchors.has('setup')).toBe(true);
    expect(anchors.has('setup-1')).toBe(true);
  });

  it('ignores headings inside code fences', () => {
    const anchors = anchorsOf('# Real\n\n```\n# Fake heading\n```\n');
    expect(anchors.has('real')).toBe(true);
    expect(anchors.has('fake-heading')).toBe(false);
  });
});

describe('linksOf', () => {
  it('extracts markdown links and images', () => {
    const links = linksOf('see [doc](a.md) and ![img](img/b.png) and <https://x.example>');
    expect(links).toEqual(['a.md', 'img/b.png']);
  });

  it('ignores links inside code fences and inline code', () => {
    const links = linksOf('use `[fake](nope.md)`\n\n```\n[also](fake.md)\n```\n[real](yes.md)');
    expect(links).toEqual(['yes.md']);
  });

  it('reads targets with a title and with angle brackets', () => {
    expect(linksOf('[a](b.md "title") [c](<d e.md>)')).toEqual(['b.md', 'd e.md']);
  });
});

describe('checkDocs on fixtures', () => {
  it('accepts a tree whose links and anchors all resolve', () => {
    const tree = fixture({
      'index.md': '# Home\n\nSee [guide](docs/guide.md#install) and [dir](docs).\n',
      'docs/guide.md': '# Guide\n\n## Install\n\nBack [home](../index.md#home).\n',
    });
    const result = checkDocs({ root: tree.root, files: tree.files });
    tree.cleanup();
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.documents).toBe(2);
  });

  it('reports a link to a missing file', () => {
    const tree = fixture({ 'index.md': 'See [ghost](nope.md).\n' });
    const result = checkDocs({ root: tree.root, files: tree.files });
    tree.cleanup();
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('missing file');
  });

  it('reports an anchor that does not exist in the target', () => {
    const tree = fixture({
      'index.md': 'See [guide](guide.md#nowhere).\n',
      'guide.md': '# Guide\n\n## Install\n',
    });
    const result = checkDocs({ root: tree.root, files: tree.files });
    tree.cleanup();
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('anchor not found');
  });

  it('reports an empty document', () => {
    const tree = fixture({ 'empty.md': '   \n' });
    const result = checkDocs({ root: tree.root, files: tree.files });
    tree.cleanup();
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('empty');
  });

  it('reports a merge conflict marker', () => {
    const tree = fixture({ 'torn.md': `# Doc\n\n${MARKER} HEAD\nours\n=======\ntheirs\n` });
    const result = checkDocs({ root: tree.root, files: tree.files });
    tree.cleanup();
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('conflict marker');
  });

  it('skips external links without any network access', () => {
    const tree = fixture({
      'index.md': '[site](https://example.invalid/x) [mail](mailto:a@b.invalid) [anchor](#top)\n\n# Top\n',
    });
    const result = checkDocs({ root: tree.root, files: tree.files });
    tree.cleanup();
    expect(result.ok).toBe(true);
  });
});

describe('checkDocs on the repository', () => {
  it('finds no broken link in the tracked documentation', () => {
    const result = checkDocs();
    expect(result.problems).toEqual([]);
    expect(result.stats.documents).toBeGreaterThan(10);
    expect(result.ok).toBe(true);
  });
});
