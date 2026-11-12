#!/usr/bin/env node
/**
 * tools/check-docs.mjs — the documentation must not lie.
 *
 * A documentation that points to a file that no longer exists is worse than
 * no documentation: the reader follows the link and lands nowhere. This tool
 * checks the tracked Markdown files:
 *
 *   - every relative link points to a file (or a directory) that exists;
 *   - every anchor cited after `#` exists in the target document, when the
 *     target is a Markdown file this tool can read (anchors of external sites
 *     are not verifiable offline and are left alone);
 *   - no tracked document is empty;
 *   - no tracked document carries a merge conflict marker.
 *
 * Links inside code fences and inline code are ignored: they are examples,
 * not navigation.
 *
 * Usage: `node tools/check-docs.mjs [--json]` — exit 0 when everything is
 * fine, 1 otherwise.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conflictLines, repoRoot, trackedFiles } from './lib/verify.mjs';

/** A link target that leaves the repository (or is not a path at all). */
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** Removes the code spans and the fenced blocks: they are examples. */
export function stripCode(text) {
  const fences = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '));
  return fences.replace(/`[^`\n]*`/g, (span) => span.replace(/[^\n]/g, ' '));
}

/** The GitHub-style anchor of a heading. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/** Every anchor a Markdown document exposes, duplicates numbered. */
export function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const match of stripCode(text).matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
    const base = slugify(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** The links of a document: `[text](target)` and `![alt](target)`. */
export function linksOf(text) {
  const links = [];
  for (const match of stripCode(text).matchAll(/!?\[[^\]]*\]\(([^)]*)\)/g)) {
    links.push(targetOf(match[1]));
  }
  return links;
}

/** The target of a link: `<path with spaces>` or `path "title"`. */
function targetOf(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    if (end > 0) return trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/)[0];
}

/**
 * Checks one document: returns the problems it holds (relative links that
 * point nowhere, anchors that do not exist, emptiness, conflict markers).
 */
export function checkDocument(root, relative) {
  const file = path.join(root, relative);
  const problems = [];
  if (!existsSync(file)) return [`${relative}: tracked document is missing on disk`];
  const text = readFileSync(file, 'utf8');
  if (text.trim().length === 0) problems.push(`${relative}: document is empty`);
  for (const line of conflictLines(text)) {
    problems.push(`${relative}:${line}: merge conflict marker`);
  }
  problems.push(...checkLinks(root, relative, text));
  return problems;
}

/** Checks the links of one document against the files of the repository. */
function checkLinks(root, relative, text) {
  const problems = [];
  const directory = path.dirname(path.join(root, relative));
  for (const target of linksOf(text)) {
    if (target.length === 0 || EXTERNAL.test(target)) continue;
    const [filePart, anchor] = target.split('#');
    const decoded = decodeURIComponent(filePart);
    const resolved = decoded.length > 0 ? path.resolve(directory, decoded) : path.join(root, relative);
    if (decoded.length > 0 && !existsSync(resolved)) {
      problems.push(`${relative}: link to a missing file — ${target}`);
      continue;
    }
    if (anchor && resolved.endsWith('.md')) {
      const problem = checkAnchor(resolved, anchor, relative, target);
      if (problem) problems.push(problem);
    }
  }
  return problems;
}

/** Checks that an anchor exists in the target document, when verifiable. */
function checkAnchor(target, anchor, relative, link) {
  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch {
    return undefined; // not readable offline: the anchor cannot be verified
  }
  const wanted = decodeURIComponent(anchor).toLowerCase();
  if (anchorsOf(text).has(wanted)) return undefined;
  return `${relative}: anchor not found in the target — ${link}`;
}

/**
 * Checks every tracked Markdown file of the repository.
 * Returns `{ ok, stats, problems }`.
 */
export function checkDocs(options = {}) {
  const root = options.root ?? repoRoot;
  const files = options.files ?? trackedFiles(['*.md'], { cwd: root });
  const problems = [];
  let links = 0;
  for (const file of files) {
    const filePath = path.join(root, file);
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, 'utf8');
    links += linksOf(text).filter((target) => !EXTERNAL.test(target)).length;
    problems.push(...checkDocument(root, file));
  }
  return { ok: problems.length === 0, stats: { documents: files.length, links }, problems };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = checkDocs();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Documentation : ${result.stats.documents} document(s), ${result.stats.links} lien(s) relatif(s)`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    console.log(result.ok ? 'Documentation : OK' : `Documentation : ${result.problems.length} problème(s)`);
  }
  process.exit(result.ok ? 0 : 1);
}
