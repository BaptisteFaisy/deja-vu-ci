/**
 * Pure logic of the Rovo/MCP console: schema → fields, response → human read.
 *
 * This module never touches the DOM: it derives everything from the action
 * descriptors of the Brain (`apps/brain/src/actions`) — the same objects the
 * Forge manifest and the `rovo:mcp` server expose — and turns the real
 * `ActionResult` of a call into facts and tables a visitor can read. Domain
 * labels (diagnostic, status, category, action, dates, confidence, commits)
 * come from `@dejavu/present`: no copied translation table.
 */

import {
  actionLabel,
  categoryLabel,
  diagnosticLabel,
  diagnosticTone,
  formatConfidence,
  formatDate,
  shortCommit,
  statusLabel,
  statusTone,
} from '@dejavu/present';
import * as brainActions from '../../../apps/brain/src/actions/index';
import type {
  ActionDescriptor,
  InputSchema,
  RawInput,
} from '../../../apps/brain/src/actions/descriptor';
import type { ActionResult } from '../../../apps/brain/src/actions/engine';
import type { ConfirmResolutionData } from '../../../apps/brain/src/actions/confirm-resolution';
import type { ExplainBuildFailureData } from '../../../apps/brain/src/actions/explain-build-failure';
import type { GetSignatureData } from '../../../apps/brain/src/actions/get-signature';
import type { ListFlakyTestsData } from '../../../apps/brain/src/actions/list-flaky-tests';
import type { ReportResolutionData } from '../../../apps/brain/src/actions/report-resolution';
import type { SearchFailuresData } from '../../../apps/brain/src/actions/search-failures';
import { SAMPLE } from '../lib/demo';
import type { DemoRun } from '../lib/demo';
import { registerStrings, t } from '../lib/i18n';
import type { Lang } from '../lib/i18n';

registerStrings({
  'rovo.resp.error': ['Error returned by the action', 'Erreur renvoyée par l’action'],
  'rovo.resp.diagnostic': ['Diagnostic', 'Diagnostic'],
  'rovo.resp.confidence': ['Confidence', 'Confiance'],
  'rovo.resp.action': ['Action to take', 'Action à mener'],
  'rovo.resp.summary': ['Summary', 'Résumé'],
  'rovo.resp.facts': ['Facts behind the decision', 'Faits derrière la décision'],
  'rovo.resp.examined': ['Signatures examined', 'Signatures examinées'],
  'rovo.resp.matches': ['Close signatures', 'Signatures proches'],
  'rovo.resp.signature': ['Signature', 'Signature'],
  'rovo.resp.status': ['Status', 'Statut'],
  'rovo.resp.category': ['Category', 'Catégorie'],
  'rovo.resp.errorType': ['Error type', 'Type d’erreur'],
  'rovo.resp.occurrences': ['Occurrences', 'Occurrences'],
  'rovo.resp.firstSeen': ['First seen', 'Première vue'],
  'rovo.resp.lastSeen': ['Last seen', 'Dernière vue'],
  'rovo.resp.issue': ['Jira ticket', 'Ticket Jira'],
  'rovo.resp.resolution': ['Resolution', 'Résolution'],
  'rovo.resp.commit': ['Commit', 'Commit'],
  'rovo.resp.confirmed': ['Confirmed by a human', 'Confirmée par un humain'],
  'rovo.resp.match': ['Match', 'Rapprochement'],
  'rovo.resp.score': ['Score', 'Score'],
  'rovo.resp.history': ['Occurrences of this signature', 'Occurrences de cette signature'],
  'rovo.resp.tests': ['Flaky tests, by CI cost', 'Tests instables, par coût CI'],
  'rovo.resp.window': ['Window (days)', 'Fenêtre (jours)'],
  'rovo.resp.minutes': ['CI minutes lost', 'Minutes de CI perdues'],
  'rovo.resp.people': ['People affected', 'Personnes touchées'],
  'rovo.resp.retries': ['Retries', 'Relances'],
  'rovo.resp.test': ['Test', 'Test'],
  'rovo.resp.repo': ['Repository', 'Dépôt'],
  'rovo.resp.branch': ['Branch', 'Branche'],
  'rovo.resp.author': ['Author', 'Auteur'],
  'rovo.resp.when': ['When', 'Quand'],
  'rovo.resp.duration': ['Duration', 'Durée'],
  'rovo.resp.flakyIndex': ['Flaky index', 'Indice d’instabilité'],
  'rovo.yes': ['Yes', 'Oui'],
  'rovo.no': ['No', 'Non'],
});

/** A callable action of the Brain, as exported by `apps/brain/src/actions`. */
export type RovoAction = ActionDescriptor<unknown>;

/** Display order: read-only first, then the two actions that write. */
const VERB_ORDER: Record<string, number> = { GET: 0, CREATE: 1, UPDATE: 2 };

/** The actions exported by the Brain, in a stable display order. */
export function listActions(): RovoAction[] {
  const descriptors = Object.values(brainActions) as unknown as RovoAction[];
  return [...descriptors].sort(
    (a, b) =>
      (VERB_ORDER[a.verb] ?? 9) - (VERB_ORDER[b.verb] ?? 9) || a.key.localeCompare(b.key),
  );
}

/** One field of a generated form, derived from the input schema. */
export interface FieldSpec {
  name: string;
  type: 'string' | 'boolean' | 'integer';
  required: boolean;
  description: string;
}

/** The fields of an action, in the order the schema declares them. */
export function fieldSpecs(inputs: InputSchema): FieldSpec[] {
  return Object.entries(inputs).map(([name, schema]) => ({
    name,
    type: schema.type,
    required: schema.required === true,
    description: schema.description,
  }));
}

/** Turns the raw strings of a form into the typed arguments of a call. */
export function coerceArgs(inputs: InputSchema, form: Record<string, string>): RawInput {
  const args: RawInput = {};
  for (const spec of fieldSpecs(inputs)) {
    const raw = (form[spec.name] ?? '').trim();
    if (raw === '') continue;
    if (spec.type === 'boolean') args[spec.name] = raw === 'true';
    else if (spec.type === 'integer') args[spec.name] = Number(raw);
    else args[spec.name] = raw;
  }
  return args;
}

/** One line of inputs, as the MCP tools table shows it. */
export function inputsLine(inputs: InputSchema): string {
  return fieldSpecs(inputs)
    .map((spec) => `${spec.name}: ${spec.type}${spec.required ? ' (required)' : ''}`)
    .join(', ');
}

/**
 * Pre-filled arguments taken from the replay itself: a real signature id, a
 * real ticket key, a real error log of the tracked sample dataset. Nothing is
 * invented — every value exists in the shared memory of the page.
 */
export function suggestArgs(view: DemoRun): Record<string, string> {
  const failure = SAMPLE.occurrences.find((entry) => entry.outcome === 'failure');
  const signature = view.signatures[0];
  const ticket = view.tickets.find((entry) => entry.issueKey);
  const resolution = SAMPLE.resolutions?.[0];
  return {
    signatureId: signature?.id ?? '',
    issueKey: ticket?.issueKey ?? signature?.issueKey ?? '',
    buildUrl: failure?.buildUrl ?? '',
    text: failure?.log ?? '',
    repository: view.repositories[0] ?? '',
    commit: resolution?.commit ?? '',
    author: resolution?.author ?? '',
    note: resolution?.note ?? '',
  };
}

/** A labelled value of the human reading, with an optional badge tone. */
export interface HumanFact {
  label: string;
  value: string;
  tone?: string;
}

/** A table of the human reading. */
export interface HumanTable {
  title: string;
  headers: string[];
  rows: string[][];
}

/** What a visitor reads next to the raw JSON. */
export interface HumanRead {
  facts: HumanFact[];
  tables: HumanTable[];
}

function fact(label: string, value: string, tone?: string): HumanFact {
  return tone ? { label, value, tone } : { label, value };
}

/** `explain-build-failure`: the diagnostic, its confidence, its facts. */
function readExplain(data: unknown, lang: Lang): HumanRead {
  const payload = data as ExplainBuildFailureData;
  return {
    facts: [
      fact(t('rovo.resp.diagnostic', lang), diagnosticLabel(payload.diagnostic.kind, lang), diagnosticTone(payload.diagnostic.kind)),
      fact(t('rovo.resp.confidence', lang), formatConfidence(payload.confidence)),
      fact(t('rovo.resp.action', lang), actionLabel(payload.diagnostic.action, lang)),
      fact(t('rovo.resp.summary', lang), payload.diagnostic.summary),
    ],
    tables: [
      {
        title: t('rovo.resp.facts', lang),
        headers: [t('rovo.resp.facts', lang)],
        rows: payload.justification.map((line) => [line]),
      },
    ],
  };
}

/** `search-failures`: the close signatures, ranked by score. */
function readSearch(data: unknown, lang: Lang): HumanRead {
  const payload = data as SearchFailuresData;
  return {
    facts: [
      fact(t('rovo.resp.summary', lang), payload.summary),
      fact(t('rovo.resp.examined', lang), String(payload.examined)),
    ],
    tables: [
      {
        title: t('rovo.resp.matches', lang),
        headers: [
          t('rovo.resp.signature', lang),
          t('rovo.resp.status', lang),
          t('rovo.resp.category', lang),
          t('rovo.resp.match', lang),
          t('rovo.resp.score', lang),
          t('rovo.resp.occurrences', lang),
          t('rovo.resp.lastSeen', lang),
          t('rovo.resp.issue', lang),
        ],
        rows: payload.matches.map((match) => [
          match.signatureShort,
          statusLabel(match.status, lang),
          categoryLabel(match.category, lang),
          match.match,
          String(Math.round(match.score * 100) / 100),
          String(match.occurrences),
          formatDate(match.lastSeen, lang),
          match.issueKey ?? '—',
        ]),
      },
    ],
  };
}

/** `get-signature`: the identity of the signature, then its occurrences. */
function readSignature(data: unknown, lang: Lang): HumanRead {
  const payload = data as GetSignatureData;
  const signature = payload.signature;
  const facts = [
    fact(t('rovo.resp.signature', lang), `${signature.signatureShort} (${signature.id})`),
    fact(t('rovo.resp.status', lang), statusLabel(payload.status, lang), statusTone(payload.status)),
    fact(t('rovo.resp.category', lang), categoryLabel(signature.category, lang)),
    fact(t('rovo.resp.errorType', lang), signature.errorType),
    fact(t('rovo.resp.firstSeen', lang), formatDate(signature.firstSeen, lang)),
    fact(t('rovo.resp.lastSeen', lang), formatDate(signature.lastSeen, lang)),
    fact(t('rovo.resp.occurrences', lang), String(signature.occurrences)),
  ];
  if (payload.issueKey) facts.push(fact(t('rovo.resp.issue', lang), payload.issueKey));
  if (payload.resolution) {
    facts.push(
      fact(t('rovo.resp.commit', lang), shortCommit(payload.resolution.commit)),
      fact(t('rovo.resp.confidence', lang), formatConfidence(payload.resolution.confidence)),
      fact(t('rovo.resp.confirmed', lang), payload.resolution.confirmedAt ? t('rovo.yes', lang) : t('rovo.no', lang)),
    );
  }
  return {
    facts,
    tables: [
      {
        title: t('rovo.resp.history', lang),
        headers: [
          t('rovo.resp.when', lang),
          t('rovo.resp.repo', lang),
          t('rovo.resp.branch', lang),
          t('rovo.resp.commit', lang),
          t('rovo.resp.author', lang),
          t('rovo.resp.duration', lang),
        ],
        rows: payload.history.map((row) => [
          formatDate(row.occurredAt, lang),
          row.repo,
          row.branch,
          shortCommit(row.commit),
          row.author,
          `${row.durationS}s`,
        ]),
      },
    ],
  };
}

/** `list-flaky-tests`: the window, the total cost, then the ranked tests. */
function readFlaky(data: unknown, lang: Lang): HumanRead {
  const payload = data as ListFlakyTestsData;
  return {
    facts: [
      fact(t('rovo.resp.summary', lang), payload.summary),
      fact(t('rovo.resp.window', lang), String(payload.windowDays)),
      fact(t('rovo.resp.minutes', lang), String(Math.round(payload.totalCiMinutesLost * 10) / 10)),
    ],
    tables: [
      {
        title: t('rovo.resp.tests', lang),
        headers: [
          t('rovo.resp.signature', lang),
          t('rovo.resp.test', lang),
          t('rovo.resp.repo', lang),
          t('rovo.resp.flakyIndex', lang),
          t('rovo.resp.minutes', lang),
          t('rovo.resp.people', lang),
          t('rovo.resp.retries', lang),
        ],
        rows: payload.tests.map((row) => [
          row.signatureShort,
          row.testName,
          row.repository,
          String(Math.round(row.flakyIndex * 100) / 100),
          String(Math.round(row.ciMinutesLost * 10) / 10),
          String(row.peopleAffected),
          String(row.retries),
        ]),
      },
    ],
  };
}

/** `report-resolution` and `confirm-resolution`: same shape, same reading. */
function readResolution(data: unknown, lang: Lang): HumanRead {
  const payload = data as ReportResolutionData | ConfirmResolutionData;
  return {
    facts: [
      fact(t('rovo.resp.summary', lang), payload.summary),
      fact(t('rovo.resp.commit', lang), shortCommit(payload.resolution.commit)),
      fact(t('rovo.resp.author', lang), payload.resolution.author),
      fact(t('rovo.resp.confidence', lang), formatConfidence(payload.resolution.confidence)),
      fact(t('rovo.resp.confirmed', lang), payload.confirmed ? t('rovo.yes', lang) : t('rovo.no', lang)),
    ],
    tables: [],
  };
}

/** The human reading of each action, keyed by the contract name. */
const READERS: Record<string, (data: unknown, lang: Lang) => HumanRead> = {
  'explain-build-failure': readExplain,
  'search-failures': readSearch,
  'get-signature': readSignature,
  'list-flaky-tests': readFlaky,
  'report-resolution': readResolution,
  'confirm-resolution': readResolution,
};

/** The human reading of a real answer — including the guard errors. */
export function humanRead(key: string, result: ActionResult<unknown>, lang: Lang): HumanRead {
  if (!result.ok) {
    return { facts: [fact(t('rovo.resp.error', lang), result.error, 'red')], tables: [] };
  }
  const reader = READERS[key];
  return reader ? reader(result.data, lang) : { facts: [], tables: [] };
}
