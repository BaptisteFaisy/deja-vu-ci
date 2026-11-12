/**
 * The data of the "Jira screens" panel — pure logic, no DOM.
 *
 * Every number and every label the panel shows comes from the product's own
 * code: the Brain's screen views (`apps/brain/src/ui/format.ts`), the app's
 * pure modules (`apps/brain/src/pure/**`) and the engine (`@dejavu/core`).
 * This module only assembles them into view models; the panel puts them in
 * shape. Nothing is recomputed here, so the panel can never disagree with the
 * app it stands for.
 *
 * Pure module: no DOM, no network, no `@forge/*` import — testable in Node.
 */

import {
  computeCost,
  signatureShort,
  type Category,
  type CostReport,
  type Diagnostic,
  type MemoryStore,
  type Occurrence,
  type ReplayResult,
  type Resolution,
  type Settings,
  type Signature,
  type SignatureStatus,
} from '@dejavu/core';
import { categoryLabel } from '@dejavu/present';
import type { Lang } from '@dejavu/present';
import {
  filterSignatureRows,
  sortSignatureRows,
  toCostRows,
  toSignatureRows,
  type CostRow,
  type SignatureRow,
  type SignatureSortKey,
} from '../../../apps/brain/src/ui/format';
import { issueContextText, NO_KNOWN_FAILURE } from '../../../apps/brain/src/pure/issueContextText';
import { assembleIncident, type IncidentPanel } from '../../../apps/brain/src/pure/incident';
import { textBar, trendMax, type CostTrend } from '../../../apps/brain/src/pure/costTrend';
import { computeCostTrend } from '../../../apps/brain/src/pure/costTrendCompute';
import { buildMemoryHealth, type MemoryHealth } from '../../../apps/brain/src/pure/memoryHealth';
import {
  auditActionOfTicket,
  auditEntry,
  sortAuditEntries,
  ticketAuditDetail,
  type AuditLine,
} from '../../../apps/brain/src/pure/auditLog';
import { buildExport, type MemoryExport } from '../../../apps/brain/src/pure/exportMemory';
import {
  MINIMIZE_POLICIES,
  type MinimizedExcerpt,
  type MinimizePolicy,
} from '../../../apps/brain/src/pure/excerptPolicy';
import { applyExcerptPolicy } from '../../../apps/brain/src/pure/excerptApply';
import {
  coerceSettingsPatch,
  excerptPolicyOf,
  toSettingsPayload,
  type SettingsPayload,
} from '../../../apps/brain/src/pure/settingsSchema';
import { DEFAULT_SETTINGS } from '../../../apps/brain/src/pure/defaults';
import { SAMPLE } from '../lib/demo';

/** What the shared workshop gives the panel. */
export interface JiraSource {
  /** The replayed memory (signatures, occurrences, resolutions). */
  store: MemoryStore;
  /** The raw replay result (diagnostics, ticket plan). */
  result: ReplayResult;
  /** The frozen clock of the demo. */
  now: Date;
}

/** Window margin, the same one the demo cost report uses. */
const WINDOW_MARGIN_DAYS = 7;

/** The cost window of the panel: the sample window, plus the margin. */
export function windowDays(): number {
  return SAMPLE.days + WINDOW_MARGIN_DAYS;
}

/** What the visitor asks the project page (sort and filters). */
export interface PageQuery {
  /** Free text over the template, the error type and the ids. */
  text: string;
  /** Status to keep, when there is one. */
  status?: SignatureStatus;
  /** Category to keep, when there is one. */
  category?: Category;
  /** The sort key — the app's own list, with its own order. */
  sortKey: SignatureSortKey;
}

/** The view model of the "CI Memory" project page. */
export interface PageData {
  /** Every row, before the filter. */
  allRows: SignatureRow[];
  /** The displayed rows: filtered, then sorted. */
  rows: SignatureRow[];
  /** The costliest signatures (the Cost tab of the same page). */
  costRows: CostRow[];
  /** The cost window, in days. */
  windowDays: number;
  /** The engine's cost report, untouched. */
  report: CostReport;
}

/** The filter of the project page, as the Brain's own filter. */
function filterOf(query: PageQuery): {
  text: string;
  status?: SignatureStatus;
  category?: Category;
} {
  return {
    text: query.text,
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
  };
}

/** The occurrences the memory really holds. */
export async function storedOccurrences(
  store: MemoryStore,
  signatures: Signature[],
): Promise<Occurrence[]> {
  const lists = await Promise.all(signatures.map((signature) => store.listOccurrences(signature.id)));
  return lists.flat();
}

/** The resolutions the memory really holds. */
export async function storedResolutions(
  store: MemoryStore,
  signatures: Signature[],
): Promise<Resolution[]> {
  const found = await Promise.all(signatures.map((signature) => store.getResolution(signature.id)));
  return found.filter((resolution): resolution is Resolution => Boolean(resolution));
}

/** The rows the project page shows for a query: filtered, then sorted. */
export function visibleRows(allRows: SignatureRow[], query: PageQuery): SignatureRow[] {
  return sortSignatureRows(filterSignatureRows(allRows, filterOf(query)), query.sortKey);
}

/** Builds the view model of the "CI Memory" project page. */
export async function pageData(source: JiraSource, query: PageQuery, lang: Lang): Promise<PageData> {
  const signatures = await source.store.listSignatures();
  const allRows = toSignatureRows(signatures, signatureShort, lang);
  const rows = visibleRows(allRows, query);
  const occurrences = await storedOccurrences(source.store, signatures);
  const report = computeCost(occurrences, {
    signatures,
    now: source.now,
    windowDays: windowDays(),
  });
  return {
    allRows,
    rows,
    costRows: toCostRows(report, signatureShort),
    windowDays: windowDays(),
    report,
  };
}

/** One signature of the issue panel picker. */
export interface IssueChoice {
  id: string;
  shortId: string;
  /** Readable label: category and error type. */
  label: string;
}

/** The view model of the issue panel. */
export interface IssueData {
  /** The chosen signature. */
  signatureId: string;
  /** The text the Rovo agent reads. */
  text: string;
  /** The current diagnostic, when the memory knows the failure. */
  diagnostic?: Diagnostic;
  /** How many failures are attached to the signature. */
  occurrences: number;
  /** The tickets seen on that signature. */
  issueKeys: string[];
}

/** The signatures the memory knows, for the picker. */
export async function issueChoices(source: JiraSource, lang: Lang): Promise<IssueChoice[]> {
  const signatures = await source.store.listSignatures();
  return signatures.map((signature) => ({
    id: signature.id,
    shortId: signatureShort(signature.id),
    label: `${categoryLabel(signature.category, lang)} — ${signature.errorType}`,
  }));
}

/** Builds the issue panel: the text a Rovo agent reads on a ticket. */
export function issueData(source: JiraSource, signatureId: string, lang: Lang): IssueData {
  const entries = source.result.diagnostics.filter(
    (entry) => entry.diagnostic.signatureId === signatureId,
  );
  if (entries.length === 0) {
    return { signatureId, text: NO_KNOWN_FAILURE, occurrences: 0, issueKeys: [] };
  }
  const latest = entries.reduce((a, b) =>
    a.occurrence.occurredAt >= b.occurrence.occurredAt ? a : b,
  );
  const occurrences = entries.map((entry) => entry.occurrence);
  const issueKeys = [
    ...new Set(
      entries
        .map((entry) => entry.diagnostic.issueKey)
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  return {
    signatureId,
    text: issueContextText({ diagnostic: latest.diagnostic, occurrences, problem: true }, lang),
    diagnostic: latest.diagnostic,
    occurrences: occurrences.length,
    issueKeys,
  };
}

/** One point of the cost trend, with its text bar. */
export interface TrendPoint {
  day: string;
  redBuilds: number;
  ciMinutesLost: number;
  bar: string;
}

/** The view model of the panels the Brain added this week. */
export interface WeeklyData {
  /** The running infrastructure incident, when there is one. */
  incident?: IncidentPanel;
  /** The cost trend. */
  trend: CostTrend;
  /** The points of the trend, with their bar. */
  points: TrendPoint[];
  /** The health of the memory. */
  health: MemoryHealth;
  /** The row counts the health estimate is built on. */
  healthRows: Record<string, number>;
  /** The audit journal, as the app would write it. */
  audit: AuditLine[];
  /** The two exports of the memory. */
  exports: MemoryExport[];
  /** The three retention policies, applied to a real excerpt. */
  excerpts: Array<{ policy: MinimizePolicy; result: MinimizedExcerpt }>;
  /** The raw excerpt the policies are applied to. */
  excerptSource: string;
}

/** The oldest occurrence of the memory, when it holds one. */
function oldestAt(occurrences: Occurrence[]): string | undefined {
  return occurrences.reduce<string | undefined>(
    (oldest, occurrence) =>
      oldest === undefined || occurrence.occurredAt < oldest ? occurrence.occurredAt : oldest,
    undefined,
  );
}

/** The row counts of the memory tables, as far as the browser can read them. */
async function countRows(
  store: MemoryStore,
  signatures: Signature[],
  occurrences: Occurrence[],
  resolutions: Resolution[],
): Promise<Record<string, number>> {
  const families = [...new Set(occurrences.map((occurrence) => occurrence.familyId))];
  const outbreaks = await Promise.all(families.map((family) => store.findOutbreak(family)));
  const stats = await store.listTestStats();
  return {
    signature: signatures.length,
    occurrence: occurrences.length,
    test_stats: stats.length,
    resolution: resolutions.length,
    raw_excerpt: 0,
    llm_template_cache: 0,
    outbreak: outbreaks.filter(Boolean).length,
    pairing: 0,
    settings: 1,
    app_policy: 0,
    audit_log: 0,
  };
}

/** The journal lines the Brain writes for a ticket plan. */
function auditLines(result: ReplayResult, signatures: Signature[], now: Date): AuditLine[] {
  const holders = new Map<string, Signature>();
  for (const signature of signatures) {
    const current = holders.get(signature.familyId);
    if (!current || signature.occurrences > current.occurrences) {
      holders.set(signature.familyId, signature);
    }
  }
  return sortAuditEntries(
    result.tickets.map((action, index) => {
      const holder = holders.get(action.familyId);
      const detail = ticketAuditDetail(action);
      return auditEntry({
        action: auditActionOfTicket(action.kind),
        ...(action.issueKey ? { issueKey: action.issueKey } : {}),
        ...(holder ? { signatureId: holder.id } : {}),
        ...(detail ? { detail } : {}),
        at: new Date(now.getTime() - index * 1000),
      });
    }),
  );
}

/** The longest raw excerpt of the sample set — a real one, not a made-up text. */
function excerptSource(): string {
  const logs = SAMPLE.occurrences
    .filter((occurrence) => occurrence.outcome === 'failure' && occurrence.log)
    .map((occurrence) => occurrence.log ?? '');
  return [...logs].sort((a, b) => b.length - a.length)[0] ?? '';
}

/** Builds the view models of the panels the Brain added this week. */
export async function weeklyData(source: JiraSource): Promise<WeeklyData> {
  const store = source.store;
  const signatures = await store.listSignatures();
  const occurrences = await storedOccurrences(store, signatures);
  const resolutions = await storedResolutions(store, signatures);
  const settings = await store.getSettings();
  const incident = await assembleIncident(store, occurrences, settings, source.now, signatureShort);
  const trend = computeCostTrend(occurrences, {
    signatures,
    now: source.now,
    windowDays: windowDays(),
  });
  const max = trendMax(trend);
  const points = trend.points.map((point) => ({
    ...point,
    bar: textBar(point.ciMinutesLost, max),
  }));
  const healthRows = await countRows(store, signatures, occurrences, resolutions);
  const oldest = oldestAt(occurrences);
  const health = buildMemoryHealth({
    rows: healthRows,
    ...(oldest ? { oldestOccurrenceAt: oldest } : {}),
    now: source.now,
  });
  const bundle = { signatures, occurrences, resolutions };
  const exports = [
    buildExport(bundle, 'csv', source.now),
    buildExport(bundle, 'json', source.now),
  ];
  const excerpt = excerptSource();
  const excerpts = MINIMIZE_POLICIES.map((policy) => ({
    policy,
    result: applyExcerptPolicy({ text: excerpt }, policy),
  }));
  return {
    ...(incident ? { incident } : {}),
    trend,
    points,
    health,
    healthRows,
    audit: auditLines(source.result, signatures, source.now),
    exports,
    excerpts,
    excerptSource: excerpt,
  };
}

/** One payload the settings validator accepts or refuses. */
export interface SettingsExample {
  /** What the page sends. */
  input: unknown;
  /** Whether the validator accepted it. */
  ok: boolean;
  /** The accepted value, when there is one. */
  value?: unknown;
  /** The refusal, when there is one. */
  error?: string;
}

/** The view model of the settings page. */
export interface SettingsData {
  /** The stored settings, projected on the page payload. */
  payload: SettingsPayload;
  /** The engine defaults. */
  defaults: Settings;
  /** What the validator accepts or refuses. */
  examples: SettingsExample[];
}

/** The payloads the settings page is exercised with. */
const SETTINGS_EXAMPLES: unknown[] = [
  { issueProjectKey: 'ci' },
  { flakyWindowDays: 400 },
  { outbreakWindowMin: '10' },
  { universalKey: 'short' },
];

/** Builds the view model of the settings page. */
export function settingsData(settings: Settings): SettingsData {
  const examples: SettingsExample[] = SETTINGS_EXAMPLES.map((input) => {
    const validation = coerceSettingsPatch(input);
    return validation.ok
      ? { input, ok: true, value: validation.value }
      : { input, ok: false, error: validation.error };
  });
  const policy = excerptPolicyOf({ excerptPolicy: 'hash-only' });
  examples.push(
    policy.ok
      ? { input: { excerptPolicy: 'hash-only' }, ok: true, value: policy.value }
      : { input: { excerptPolicy: 'hash-only' }, ok: false, error: policy.error },
  );
  return { payload: toSettingsPayload(settings), defaults: DEFAULT_SETTINGS, examples };
}
