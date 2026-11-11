/**
 * Tests of the Jira helpers (`src/pure/jira.ts`): ADF conversion, request
 * bodies and the detection of the app's own last synthesis comment (the
 * daily brake of § 11).
 */

import { describe, expect, it } from 'vitest';
import type { TicketAction } from '@dejavu/core';
import {
  SYNTHESIS_MARKER,
  commentBody,
  createIssueBody,
  findLastSynthesisAt,
  textToAdf,
  updateIssueBody,
} from '../src/pure/jira.js';

const action: TicketAction = {
  kind: 'create',
  familyId: 'fam1',
  signatureId: 'sig1',
  summary: 'Flaky test: test_login',
  description: 'line one\nline two',
  labels: ['deja-vu-ci', 'test-instable'],
};

describe('textToAdf', () => {
  it('builds one paragraph per line, marker first when given', () => {
    const doc = textToAdf('a\nb', SYNTHESIS_MARKER);
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(3);
    expect(doc.content[0].content?.[0]?.text).toBe(SYNTHESIS_MARKER);
    expect(doc.content[2].content?.[0]?.text).toBe('b');
  });

  it('renders an empty line as an empty paragraph', () => {
    const doc = textToAdf('a\n\nb');
    expect(doc.content[1]).toEqual({ type: 'paragraph', content: [] });
  });
});

describe('request bodies', () => {
  it('creates an issue in the configured project with labels', () => {
    const body = createIssueBody(action, 'PAY');
    expect(body.fields.project).toEqual({ key: 'PAY' });
    expect(body.fields.summary).toBe(action.summary);
    expect(body.fields.labels).toEqual(['deja-vu-ci', 'test-instable']);
    expect(body.fields.issuetype).toEqual({ name: 'Task' });
  });

  it('posts a comment with the app marker', () => {
    const body = commentBody('daily synthesis');
    expect(JSON.stringify(body.body)).toContain(SYNTHESIS_MARKER);
  });

  it('edits summary, description and labels on update', () => {
    const body = updateIssueBody({ ...action, kind: 'update', issueKey: 'PAY-1' });
    expect(body.fields.summary).toBe(action.summary);
    expect(body.fields.description).toBeDefined();
    expect(body.fields.labels).toEqual(action.labels);
  });
});

describe('findLastSynthesisAt', () => {
  const comments = [
    { created: '2026-11-01T08:00:00.000Z', body: { text: `${SYNTHESIS_MARKER} sig1 synthesis` } },
    { created: '2026-11-03T08:00:00.000Z', body: { text: 'a human comment' } },
    { created: '2026-11-02T08:00:00.000Z', body: { text: `${SYNTHESIS_MARKER} sig1 synthesis` } },
    { created: '2026-11-04T08:00:00.000Z', body: { text: `${SYNTHESIS_MARKER} sig2 other signature` } },
  ];

  it('returns the latest own comment of the signature', () => {
    expect(findLastSynthesisAt(comments, 'sig1')).toBe('2026-11-02T08:00:00.000Z');
  });

  it('ignores other signatures, human comments and unknown dates', () => {
    expect(findLastSynthesisAt(comments, 'sig2')).toBe('2026-11-04T08:00:00.000Z');
    expect(findLastSynthesisAt(comments, 'sig3')).toBeUndefined();
    expect(findLastSynthesisAt([{ body: { text: SYNTHESIS_MARKER } }], 'sig1')).toBeUndefined();
  });
});
