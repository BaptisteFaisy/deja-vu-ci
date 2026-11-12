/**
 * Size limits of the repository: a file stays under 500 lines, a function
 * stays under 50 lines (docs/CONTRACTS.md). The scanner is a heuristic, not a
 * parser: it blanks out comments and string literals, then matches the usual
 * TypeScript shapes (function declarations, arrow assignments, class/object
 * methods) and counts the lines between the opening brace and its match.
 *
 * The heuristic is deliberately conservative: it may miss an exotic shape, it
 * never invents a violation. Every reported span carries its file and line so
 * a human can confirm it in seconds.
 */

import { readFileSync } from 'node:fs';

/** Limits of the repository (docs/CONTRACTS.md). */
export const MAX_FILE_LINES = 500;
export const MAX_FUNCTION_LINES = 50;

/** Words that look like a method start but are control flow. */
const NOT_FUNCTIONS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do',
  'try', 'new', 'delete', 'typeof', 'await', 'yield', 'case', 'in', 'of',
  'super', 'this', 'import', 'export', 'const', 'let', 'var', 'with', 'finally',
]);

/** `function name(…)`, `const name = (…) => {`, with the usual modifiers. */
const DECLARATION = /(?:^|\n)([ \t]*)(?:(?:export|default|async|static|public|private|protected|declare|override|abstract)[ \t]+)*(?:function[ \t*]+([A-Za-z0-9_$]+)|(?:const|let|var)[ \t]+([A-Za-z0-9_$]+)[ \t]*=[ \t]*(?:async[ \t]*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)[ \t]*(?::[^=>\n]+)?=>[ \t]*\{)/g;

/** Method shorthand: `name(args) {`, `async name(args): Type {`. */
const METHOD = /(?:^|\n)([ \t]*)(?:(?:public|private|protected|static|async|override|get|set)[ \t]+)*([A-Za-z0-9_$]+)[ \t]*(?:<[^<>]*>)?\([^)]*\)[ \t]*(?::[^;{=]*?)?[ \t]*\{/g;

/** Consumes one comment or string starting at `i`; code falls through. */
function nextChunk(source, i) {
  const c = source[i];
  const n = source.length;
  if (c === '/' && source[i + 1] === '/') {
    let j = i;
    while (j < n && source[j] !== '\n') j += 1;
    return { end: j, text: '' };
  }
  if (c === '/' && source[i + 1] === '*') {
    let j = i + 2;
    let text = '';
    while (j < n && !(source[j] === '*' && source[j + 1] === '/')) {
      if (source[j] === '\n') text += '\n';
      j += 1;
    }
    return { end: Math.min(j + 2, n), text: `${text} ` };
  }
  if (c === '"' || c === "'" || c === '`') return blankString(source, i);
  return { end: i + 1, text: c };
}

/** Blanks a string literal, keeping its newlines and its `${…}` placeholders. */
function blankString(source, start) {
  const quote = source[start];
  const n = source.length;
  let i = start + 1;
  let text = '';
  while (i < n && source[i] !== quote) {
    if (source[i] === '\\') {
      if (source[i + 1] === '\n') text += '\n';
      i += 2;
      continue;
    }
    if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
      const placeholder = templatePlaceholder(source, i);
      text += placeholder.text;
      i = placeholder.end;
      continue;
    }
    if (source[i] === '\n') text += '\n';
    i += 1;
  }
  return { end: Math.min(i + 1, n), text: `${text}S` };
}

/** Copies a `${…}` placeholder verbatim — its braces stay balanced. */
function templatePlaceholder(source, start) {
  const n = source.length;
  let i = start + 2;
  let depth = 1;
  let text = '${';
  while (i < n && depth > 0) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    text += source[i];
    i += 1;
  }
  return { end: Math.min(i + 1, n), text: `${text}}` };
}

/**
 * Blanks out comments and string literals, preserving the line structure: the
 * scanner then sees only code, and a brace inside a string cannot fool it.
 */
export function blankOutLiterals(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const chunk = nextChunk(source, i);
    out += chunk.text;
    i = chunk.end;
  }
  return out;
}

/** Index of the closing brace matching the opening brace at `open`. */
function matchBrace(source, open) {
  let depth = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** 1-based line number of a character index. */
function lineOf(source, index) {
  let line = 1;
  for (let j = 0; j < index; j += 1) if (source[j] === '\n') line += 1;
  return line;
}

/** Collects the function spans one matcher finds in the blanked source. */
function spansOf(source, matcher, nameOf) {
  const found = [];
  matcher.lastIndex = 0;
  let match = matcher.exec(source);
  while (match !== null) {
    if (match[0] === '') {
      matcher.lastIndex += 1;
      match = matcher.exec(source);
      continue;
    }
    const open = source.indexOf('{', match.index + match[0].length - 1);
    const close = open >= 0 ? matchBrace(source, open) : -1;
    const name = nameOf(match);
    if (close >= 0 && name && !NOT_FUNCTIONS.has(name)) {
      const startLine = lineOf(source, match.index + (match[0].startsWith('\n') ? 1 : 0));
      found.push({ name, startLine, lines: lineOf(source, close) - startLine + 1 });
    }
    matcher.lastIndex = close > match.index ? close : match.index + match[0].length;
    match = matcher.exec(source);
  }
  return found;
}

/** Every function span of a source file (declarations + methods). */
export function functionSpans(source) {
  const blanked = blankOutLiterals(source);
  const declarations = spansOf(blanked, DECLARATION, (match) => match[2] ?? match[3]);
  const starts = new Set(declarations.map((span) => span.startLine));
  const methods = spansOf(blanked, METHOD, (match) => match[2]).filter(
    (span) => !starts.has(span.startLine),
  );
  return [...declarations, ...methods].sort((a, b) => a.startLine - b.startLine);
}

/**
 * Scans one tracked TypeScript file: total lines and oversized functions.
 * Returns `{ file, lines, oversized }` with the offending spans listed.
 */
export function scanFile(file) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n').length;
  const oversized = functionSpans(source).filter((span) => span.lines > MAX_FUNCTION_LINES);
  return { file, lines, oversized };
}
