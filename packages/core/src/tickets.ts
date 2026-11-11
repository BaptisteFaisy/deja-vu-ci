/**
 * One ticket per problem (§ 11).
 *
 * The uniqueness key is the *family* of the signature: two different
 * families never share a ticket, and two signatures of the same family
 * always end up in the same ticket.
 *
 * The planner is pure: it never talks to Jira. It returns the list of
 * actions the Cerveau must apply, and the discretion rules are baked in:
 * at most one synthesis comment per day and per ticket.
 */
import type {
  FlakyVerdict,
  Occurrence,
  Settings,
  Signature,
  TicketAction,
} from './types.js';
import { computeCost } from './cost.js';
import { detectRegression } from './resolutions.js';

/** Input of the ticket planner. */
export interface TicketPlanInput {
  /** The signature the plan is about. */
  signature: Signature;
  /** Known occurrences of the signature (all branches). */
  occurrences: Occurrence[];
  /** Flakiness verdict, when it has been computed. */
  verdict?: FlakyVerdict;
  /** Key of the ticket already opened for the family, when there is one. */
  existingIssueKey?: string;
  /** ISO date of the last synthesis comment published on the ticket. */
  lastCommentAt?: string;
  /** Reference date. */
  now?: Date;
  /** Project settings (reserved for future thresholds). */
  settings?: Partial<Settings>;
}

/** A ticket is proposed for closure after 14 days without occurrence (§ 11). */
const CLOSE_AFTER_DAYS = 14;
/** A day in milliseconds. */
const DAY_MS = 86_400_000;
/** Maximum length of the normalized excerpt quoted in the description. */
const EXCERPT_MAX_CHARS = 600;
/** Labels attached to every problem ticket. */
const BASE_LABELS = ['deja-vu-ci'];
/** Label of a ticket opened for an unstable test (§ 8.2). */
const FLAKY_LABEL = 'test-instable';

/**
 * Uniqueness key of the ticket of a signature: its family.
 *
 * Two signatures of the same family share the same ticket; two signatures of
 * different families never do.
 */
export function ticketKeyFor(signature: Signature): string {
  return signature.familyId;
}

/** True when two signatures belong to the same problem. */
export function sameProblem(a: Signature, b: Signature): boolean {
  return ticketKeyFor(a) === ticketKeyFor(b);
}

/** ISO day (UTC) of a date, used to compare days. */
function dayOf(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** True when the last comment was published on the same day as `now`. */
function commentedToday(lastCommentAt: string | undefined, now: Date): boolean {
  if (!lastCommentAt) return false;
  const day = dayOf(lastCommentAt);
  return day !== '' && day === dayOf(now);
}

/** Occurrences that happened after the last comment (or all of them). */
function newOccurrences(occs: Occurrence[], lastCommentAt?: string): Occurrence[] {
  const limit = lastCommentAt ? Date.parse(lastCommentAt) : Number.NEGATIVE_INFINITY;
  return occs.filter((occ) => Date.parse(occ.occurredAt) > limit);
}

/** Occurrences of the current day. */
function occurrencesOfDay(occs: Occurrence[], now: Date): Occurrence[] {
  const today = dayOf(now);
  return occs.filter((occ) => dayOf(occ.occurredAt) === today);
}

/** Name of the test or of the error, for the ticket title. */
function problemName(signature: Signature): string {
  if (signature.testName) return signature.testName;
  if (signature.errorType) return signature.errorType;
  return signature.template.split('\n')[0] ?? signature.id;
}

/** Normalized excerpt of the failure, quoted in the description. */
function excerpt(signature: Signature): string {
  const text = signature.template.trim();
  return text.length > EXCERPT_MAX_CHARS ? `${text.slice(0, EXCERPT_MAX_CHARS)}...` : text;
}

/** Markdown table of the occurrences (date, repository, branch, link). */
function occurrenceTable(occs: Occurrence[]): string {
  const rows = occs
    .slice()
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .map((occ) => {
      const link = occ.buildUrl ? occ.buildUrl : '-';
      return `| ${occ.occurredAt} | ${occ.repo} | ${occ.branch} | ${link} |`;
    });
  return ['| Date | Repository | Branch | Link |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

/** Cost lines quoted in the ticket description (CI-14). */
function costLines(occs: Occurrence[], now: Date): string {
  const cost = computeCost(occs, { now });
  return [
    `- Red builds: ${cost.redBuilds}`,
    `- CI minutes lost: ${cost.ciMinutesLost}`,
    `- People affected: ${cost.peopleAffected}`,
    `- Retries: ${cost.retries}`,
  ].join('\n');
}

/** Suggested owner: the author of the most recent occurrence. */
function suggestAssignee(occs: Occurrence[]): string | undefined {
  const latest = occs
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return latest?.author;
}

/** Body of the ticket: what failed, where, and what it costs. */
function buildDescription(
  signature: Signature,
  occs: Occurrence[],
  now: Date,
): string {
  return [
    `**Problem**: ${problemName(signature)}`,
    `**Signature**: ${signature.id} (family ${signature.familyId})`,
    '',
    '**Normalized excerpt**',
    '```',
    excerpt(signature),
    '```',
    '',
    '**Occurrences**',
    occurrenceTable(occs),
    '',
    '**Cost**',
    costLines(occs, now),
  ].join('\n');
}

/** Title of the ticket. */
function buildSummary(signature: Signature, occs: Occurrence[]): string {
  const name = problemName(signature);
  return `[CI] ${name} (${occs.length} occurrence${occs.length > 1 ? 's' : ''})`;
}

/** Labels of the ticket. */
function buildLabels(signature: Signature, flaky: boolean): string[] {
  const labels = [...BASE_LABELS];
  if (flaky) labels.push(FLAKY_LABEL);
  if (signature.category === 'test' && !flaky) labels.push('test-failure');
  return labels;
}

/** True when the signature is known to be a flaky test (§ 10.1). */
function isFlaky(signature: Signature, verdict?: FlakyVerdict): boolean {
  return verdict?.flaky === true || signature.status === 'flaky';
}

/** True when the signature reappears after a resolution (§ 8.4). */
function isRegression(signature: Signature, occs: Occurrence[]): boolean {
  if (signature.status === 'regression') return true;
  const latest = occs
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return latest ? detectRegression(signature, latest) : false;
}

/** True when nothing happened for long enough to propose a closure. */
function isStale(signature: Signature, occs: Occurrence[], now: Date): boolean {
  const latest = mostRecent(occs);
  const reference = latest?.occurredAt ?? signature.lastSeen;
  if (!reference) return false;
  const then = Date.parse(reference);
  if (Number.isNaN(then)) return false;
  return now.getTime() - then > CLOSE_AFTER_DAYS * DAY_MS;
}

/** Occurrences sorted oldest first (the input order is not trusted). */
function chronological(occs: Occurrence[]): Occurrence[] {
  return occs.slice().sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

/** The most recent occurrence of the list. */
function mostRecent(occs: Occurrence[]): Occurrence | undefined {
  return chronological(occs)[occs.length - 1];
}

/**
 * True when the problem came back after a long silence: the gap between the
 * two last occurrences is wider than the closure threshold, so the ticket had
 * been proposed for closure and must be reopened instead.
 */
function cameBackAfterSilence(occs: Occurrence[]): boolean {
  const sorted = chronological(occs);
  if (sorted.length < 2) return false;
  const previous = Date.parse(sorted[sorted.length - 2].occurredAt);
  const latest = Date.parse(sorted[sorted.length - 1].occurredAt);
  if (Number.isNaN(previous) || Number.isNaN(latest)) return false;
  return latest - previous > CLOSE_AFTER_DAYS * DAY_MS;
}

/**
 * Text of the daily synthesis of a problem.
 *
 * One comment per day and per ticket: the text summarizes the occurrences of
 * the day, the branches involved, the last time the problem was seen and the
 * cost so far. It never repeats one comment per occurrence.
 */
export function dailySynthesis(
  signature: Signature,
  occurrences: Occurrence[],
  now: Date = new Date(),
): string {
  const today = occurrencesOfDay(occurrences, now);
  const branches = [...new Set(today.map((occ) => occ.branch))].sort();
  const latest = occurrences
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  const cost = computeCost(occurrences, { now });
  const name = problemName(signature);

  const lines = [
    `**${name}** - ${signature.id}`,
    '',
    `- Occurrences today: ${today.length}`,
    `- Branches today: ${branches.length > 0 ? branches.join(', ') : 'none'}`,
    `- Last seen: ${latest?.occurredAt ?? 'unknown'}`,
    `- Total occurrences: ${occurrences.length}`,
    `- CI minutes lost so far: ${cost.ciMinutesLost}`,
  ];
  if (today.length > 0) {
    lines.push('', '**Occurrences of the day**', occurrenceTable(today));
  }
  return lines.join('\n');
}

/** Common fields of every ticket action of a family. */
function baseAction(
  signature: Signature,
  occs: Occurrence[],
  flaky: boolean,
): Omit<TicketAction, 'kind'> {
  return {
    familyId: ticketKeyFor(signature),
    signatureId: signature.id,
    summary: buildSummary(signature, occs),
    labels: buildLabels(signature, flaky),
    assignee: suggestAssignee(occs),
  };
}

/** Context shared by the steps of a plan. */
interface PlanContext {
  signature: Signature;
  occs: Occurrence[];
  issueKey: string;
  flaky: boolean;
  now: Date;
  base: Omit<TicketAction, 'kind'>;
}

/** `reopen` plus refreshed properties when the problem comes back (§ 8.4). */
function reopenActions(ctx: PlanContext, alreadyToday: boolean): TicketAction[] {
  const description = buildDescription(ctx.signature, ctx.occs, ctx.now);
  const actions: TicketAction[] = [
    { ...ctx.base, kind: 'reopen', issueKey: ctx.issueKey, description },
    { ...ctx.base, kind: 'update', issueKey: ctx.issueKey, description },
  ];
  if (!alreadyToday) {
    actions.push({
      ...ctx.base,
      kind: 'comment',
      issueKey: ctx.issueKey,
      comment: dailySynthesis(ctx.signature, ctx.occs, ctx.now),
      commentAlreadyToday: false,
    });
  }
  return actions;
}

/** `update` (properties) plus at most one synthesis comment per day. */
function refreshActions(ctx: PlanContext, alreadyToday: boolean): TicketAction[] {
  const actions: TicketAction[] = [
    {
      ...ctx.base,
      kind: 'update',
      issueKey: ctx.issueKey,
      description: buildDescription(ctx.signature, ctx.occs, ctx.now),
      commentAlreadyToday: alreadyToday,
    },
  ];
  if (!alreadyToday) {
    actions.push({
      ...ctx.base,
      kind: 'comment',
      issueKey: ctx.issueKey,
      comment: dailySynthesis(ctx.signature, ctx.occs, ctx.now),
      commentAlreadyToday: false,
    });
  }
  return actions;
}

/** Plan of the actions of a family that already has a ticket. */
function planExistingIssue(ctx: PlanContext, lastCommentAt?: string): TicketAction[] {
  const fresh = newOccurrences(ctx.occs, lastCommentAt);
  const alreadyToday = commentedToday(lastCommentAt, ctx.now);
  const cameBack = isRegression(ctx.signature, ctx.occs) || cameBackAfterSilence(ctx.occs);

  if (cameBack) return reopenActions(ctx, alreadyToday);

  if (isStale(ctx.signature, ctx.occs, ctx.now)) {
    const actions: TicketAction[] = [
      { ...ctx.base, kind: 'close-suggested', issueKey: ctx.issueKey },
    ];
    if (fresh.length > 0) {
      actions.unshift({
        ...ctx.base,
        kind: 'update',
        issueKey: ctx.issueKey,
        description: buildDescription(ctx.signature, ctx.occs, ctx.now),
        commentAlreadyToday: alreadyToday,
      });
    }
    return actions;
  }

  if (fresh.length === 0) return [];
  return refreshActions(ctx, alreadyToday);
}

/**
 * Plan of the actions to apply to the ticket of a family.
 *
 * - `create` when the problem becomes unstable,
 * - `update` when new occurrences change the properties of the ticket,
 * - `comment` at most once per day and per ticket,
 * - `close-suggested` after 14 days without occurrence,
 * - `reopen` when the problem comes back.
 */
export function planTicketActions(input: TicketPlanInput): TicketAction[] {
  const now = input.now ?? new Date();
  const signature = input.signature;
  const occs = input.occurrences;
  const flaky = isFlaky(signature, input.verdict);
  const base = baseAction(signature, occs, flaky);

  if (!input.existingIssueKey) {
    return flaky ? [{ ...base, kind: 'create', description: buildDescription(signature, occs, now) }] : [];
  }

  const ctx: PlanContext = { signature, occs, issueKey: input.existingIssueKey, flaky, now, base };
  return planExistingIssue(ctx, input.lastCommentAt);
}

/**
 * Ticket creation on request (§ 11: "création à la demande pour toute
 * signature"). The frozen `TicketPlanInput` carries no request flag, so the
 * explicit path is this function: it never creates a second ticket for a
 * family that already has one.
 */
export function requestTicket(input: TicketPlanInput): TicketAction[] {
  if (input.existingIssueKey) return planTicketActions(input);
  const now = input.now ?? new Date();
  const flaky = isFlaky(input.signature, input.verdict);
  const base = baseAction(input.signature, input.occurrences, flaky);
  return [
    {
      ...base,
      kind: 'create',
      description: buildDescription(input.signature, input.occurrences, now),
    },
  ];
}
