/**
 * Language model fallback (§ 9.5).
 *
 * The model is only a safety net: it is called when no pattern recognised the
 * error block. Its answer is cached by the hash of the normalized text, so the
 * very same raw error is never submitted twice. A malformed or unreachable
 * model never breaks the pipeline: the deterministic fallback is used instead.
 */

import { createHash } from 'crypto';
import type { Category, ErrorBlock } from './types.js';

/** Minimal contract of the model used as a fallback. */
export interface LlmFallback {
  complete(prompt: string): Promise<string>;
}

/** A canonical error template with its category. */
export interface LlmNormalizeResult {
  template: string;
  category: Category;
}

/** Every category the engine knows about. */
const CATEGORIES: readonly Category[] = [
  'test',
  'compile',
  'style',
  'dependency',
  'infrastructure',
  'timeout',
  'config',
  'unknown',
];

/** Cache of the templates already produced, keyed by normalized text hash. */
export class TemplateCache {
  private readonly entries = new Map<string, LlmNormalizeResult>();

  get(hash: string): LlmNormalizeResult | undefined {
    return this.entries.get(hash);
  }

  set(hash: string, value: LlmNormalizeResult): void {
    this.entries.set(hash, value);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Hash of the normalized text of a block: same error, same key. */
export function normalizedHash(block: ErrorBlock): string {
  return createHash('sha256')
    .update(`${block.category}|${block.errorType}|${block.message}`)
    .digest('hex');
}

/** Prompt sent to the model; the answer must be machine readable. */
export function buildPrompt(block: ErrorBlock): string {
  return [
    'Normalize the following build error.',
    'Answer with exactly two lines:',
    'category: <one of test, compile, style, dependency, infrastructure, timeout, config, unknown>',
    'template: <a short canonical message, variables replaced by placeholders>',
    '---',
    block.rawText.slice(0, 4000),
  ].join('\n');
}

/** Parse a model answer: JSON first, then the two-line form. */
export function parseAnswer(answer: string): LlmNormalizeResult | undefined {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return undefined;
  const fromJson = parseJsonAnswer(trimmed);
  if (fromJson) return fromJson;
  const category = /^category\s*:\s*(.+)$/im.exec(trimmed)?.[1]?.trim().toLowerCase();
  const template = /^template\s*:\s*(.+)$/im.exec(trimmed)?.[1]?.trim();
  if (!category || !template) return undefined;
  return { template, category: toCategory(category) };
}

/** Parse a JSON answer, ignoring a surrounding code fence. */
function parseJsonAnswer(text: string): LlmNormalizeResult | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { template?: unknown; category?: unknown };
    if (typeof parsed.template !== 'string' || typeof parsed.category !== 'string') return undefined;
    return { template: parsed.template, category: toCategory(parsed.category) };
  } catch {
    return undefined;
  }
}

/** Map an unknown category name onto a known one. */
function toCategory(name: string): Category {
  const found = CATEGORIES.find((c) => c === name.toLowerCase());
  return found ?? 'unknown';
}

/** Deterministic answer used when the model is unusable. */
function deterministicResult(block: ErrorBlock): LlmNormalizeResult {
  return { template: block.message, category: block.category };
}

/**
 * Normalize a block, using the model only as a fallback.
 *
 * The result is always defined: a model that answers nonsense, throws, or is
 * not reachable yields the deterministic normalization of the block.
 */
export async function llmNormalize(
  block: ErrorBlock,
  llm: LlmFallback,
  cache: TemplateCache,
): Promise<LlmNormalizeResult> {
  const hash = normalizedHash(block);
  const cached = cache.get(hash);
  if (cached) return cached;
  if (block.category !== 'unknown') {
    const result = deterministicResult(block);
    cache.set(hash, result);
    return result;
  }
  const result = await askModel(block, llm);
  cache.set(hash, result);
  return result;
}

/** Ask the model, never letting an error escape. */
async function askModel(block: ErrorBlock, llm: LlmFallback): Promise<LlmNormalizeResult> {
  try {
    const answer = await llm.complete(buildPrompt(block));
    const parsed = parseAnswer(answer);
    if (!parsed || parsed.template.length === 0) return deterministicResult(block);
    return parsed;
  } catch {
    return deterministicResult(block);
  }
}
