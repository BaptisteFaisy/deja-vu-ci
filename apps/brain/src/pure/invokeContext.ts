/**
 * Where the issue and the project hide in what Forge hands over — pure, no
 * Forge import.
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
 *
 * The **project** is read the same way, out of the same envelope: the project
 * page of the manifest carries `context.extension.project.key` (Atlassian's
 * documented extension data for `jira:projectPage`, and the same shape for
 * `jira:issuePanel`), which is what tells the Brain which project the operator
 * is looking at. One lookup, two keys: the candidate order is written once.
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

/** A non-empty string, or `''`. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Reads `issueKey`, `issue.key` or `extension.issue.key` out of one candidate. */
function issueKeyIn(record: Record<string, unknown>): string {
  if (text(record.issueKey)) return text(record.issueKey);
  const issue = asRecord(record.issue) ?? asRecord(asRecord(record.extension)?.issue);
  return issue ? text(issue.key) : '';
}

/**
 * Reads `projectKey`, `project.key` or `extension.project.key` out of one
 * candidate. The `issue.key` is deliberately **not** read: a project key is a
 * different thing from the key of the ticket the panel is showing.
 */
function projectKeyIn(record: Record<string, unknown>): string {
  if (text(record.projectKey)) return text(record.projectKey);
  const project = asRecord(record.project) ?? asRecord(asRecord(record.extension)?.project);
  if (project) {
    const key = text(project.key);
    if (key) return key;
  }
  // The platform context of a Jira module carries the project too; it is the
  // last resort, after the extension data of the module itself.
  return text(asRecord(record.platformContext)?.projectKey);
}

/**
 * The candidates of one envelope, in the order they are read: the payload
 * itself, what a UI Kit 2 `invoke()` wrapped inside it, then the context, on
 * both sides. A bare payload wins over the context, so an explicit value never
 * loses against an ambient one.
 */
function candidatesOf(envelope: InvokeEnvelope): Record<string, unknown>[] {
  const payload = asRecord(envelope.payload);
  const call = asRecord(payload?.call);
  const raw: unknown[] = [
    payload,
    call?.payload,
    call?.arguments,
    payload?.context,
    envelope.context,
  ];
  return raw.map(asRecord).filter((one): one is Record<string, unknown> => one !== undefined);
}

/** The first non-empty answer of `read` over the candidates of an envelope. */
function firstOf(envelope: InvokeEnvelope, read: (record: Record<string, unknown>) => string): string {
  for (const candidate of candidatesOf(envelope)) {
    const key = read(candidate);
    if (key) return key;
  }
  return '';
}

/**
 * The issue key of an invocation, or `''` when the call carries none.
 *
 * An empty answer is not an error: the caller renders "no known failure"
 * rather than guessing an issue.
 */
export function issueKeyFrom(envelope: InvokeEnvelope): string {
  return firstOf(envelope, issueKeyIn);
}

/**
 * The project key of an invocation, or `''` when the call carries none.
 *
 * This is the project the operator is **looking at** — the project page, or
 * the project of the ticket an issue panel is showing. A background call (the
 * queue consumer, a web trigger) carries no such context and answers `''`:
 * the caller then falls back on the settings, or refuses to write.
 */
export function projectKeyFrom(envelope: InvokeEnvelope): string {
  return firstOf(envelope, projectKeyIn);
}
