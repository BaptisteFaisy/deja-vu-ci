/**
 * Where the issue key hides in what Forge hands over — pure, no Forge import.
 *
 * The same resolver is reached through two shapes:
 *  - a UI Kit 2 `invoke()` (the platform wraps the call:
 *    `{ call: { functionKey, payload }, context }`, and the issue lives in
 *    `context.extension.issue.key`);
 *  - a plain module function such as `jira:issueContext`, called with
 *    `(payload, context)` where the issue may be on either side.
 *
 * Looking in one place only, in a fixed order, keeps the panel and the Rovo
 * text context reading the same issue — and is unit-testable without a tenant.
 */

/** One invocation: what the platform passed, on both sides. */
export interface InvokeEnvelope {
  payload?: unknown;
  context?: unknown;
}

/** A value as an object, or `undefined` when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Reads `issueKey`, `issue.key` or `extension.issue.key` out of one candidate. */
function keyIn(candidate: unknown): string {
  const record = asRecord(candidate);
  if (!record) return '';
  if (typeof record.issueKey === 'string' && record.issueKey) return record.issueKey;
  const issue = asRecord(record.issue) ?? asRecord(asRecord(record.extension)?.issue);
  return issue && typeof issue.key === 'string' ? issue.key : '';
}

/**
 * The issue key of an invocation, or `''` when the call carries none.
 *
 * An empty answer is not an error: the caller renders "no known failure"
 * rather than guessing an issue.
 */
export function issueKeyFrom(envelope: InvokeEnvelope): string {
  const payload = asRecord(envelope.payload);
  const call = asRecord(payload?.call);
  const candidates: unknown[] = [
    payload,
    call?.payload,
    call?.arguments,
    payload?.context,
    envelope.context,
  ];
  for (const candidate of candidates) {
    const key = keyIn(candidate);
    if (key) return key;
  }
  return '';
}
