import { describe, expect, it } from 'vitest';
import { TemplateCache, llmNormalize, type LlmFallback } from '../src/llm.js';
import type { ErrorBlock } from '../src/types.js';

function block(overrides: Partial<ErrorBlock> = {}): ErrorBlock {
  return {
    category: 'unknown',
    errorType: 'UnknownError',
    message: 'boom happened in module <a>',
    rawMessage: 'boom happened in module a',
    frames: [],
    source: 'log',
    rawText: 'boom happened in module a',
    ...overrides,
  };
}

/** A model that counts its calls and always answers the same text. */
function countingModel(answer: string): LlmFallback & { calls: number } {
  const model = {
    calls: 0,
    async complete(): Promise<string> {
      model.calls += 1;
      return answer;
    },
  };
  return model;
}

describe('TemplateCache', () => {
  it('stores and reads a template by hash', () => {
    const cache = new TemplateCache();
    expect(cache.get('abc')).toBeUndefined();
    cache.set('abc', { template: 'a failed', category: 'test' });
    expect(cache.get('abc')?.category).toBe('test');
    expect(cache.size).toBe(1);
  });
});

describe('llmNormalize', () => {
  it('calls the model once for two identical texts', async () => {
    const cache = new TemplateCache();
    const model = countingModel('category: test\ntemplate: the check failed');
    const first = await llmNormalize(block(), model, cache);
    const second = await llmNormalize(block(), model, cache);
    expect(model.calls).toBe(1);
    expect(first).toEqual(second);
    expect(first.category).toBe('test');
    expect(first.template).toBe('the check failed');
  });

  it('calls the model again for a different text', async () => {
    const cache = new TemplateCache();
    const model = countingModel('category: test\ntemplate: the check failed');
    await llmNormalize(block(), model, cache);
    await llmNormalize(block({ message: 'another boom' }), model, cache);
    expect(model.calls).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('falls back on the deterministic answer when the model answers out of format', async () => {
    const cache = new TemplateCache();
    const model = countingModel('I am a chatbot and I refuse to answer');
    const result = await llmNormalize(block({ category: 'test' }), model, cache);
    expect(result.category).toBe('test');
    expect(result.template).toBe('boom happened in module <a>');
  });

  it('never throws when the model fails', async () => {
    const cache = new TemplateCache();
    const model: LlmFallback = {
      complete: async () => {
        throw new Error('model unreachable');
      },
    };
    const result = await llmNormalize(block({ category: 'compile' }), model, cache);
    expect(result.category).toBe('compile');
  });

  it('does not call the model when the category is already known', async () => {
    const cache = new TemplateCache();
    const model = countingModel('category: timeout\ntemplate: too slow');
    const result = await llmNormalize(block({ category: 'timeout' }), model, cache);
    expect(model.calls).toBe(0);
    expect(result.category).toBe('timeout');
  });

  it('reads a JSON answer from the model', async () => {
    const cache = new TemplateCache();
    const model = countingModel('{"template":"the check failed","category":"test"}');
    const result = await llmNormalize(block(), model, cache);
    expect(result).toEqual({ template: 'the check failed', category: 'test' });
  });

  it('maps an unknown category onto the unknown one', async () => {
    const cache = new TemplateCache();
    const model = countingModel('category: cosmic-ray\ntemplate: weird');
    const result = await llmNormalize(block(), model, cache);
    expect(result.category).toBe('unknown');
  });
});
