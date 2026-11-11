/**
 * Labels and visual tones of the domain vocabulary (§ 5, § 9.4, § 14).
 *
 * One table per enum of `@dejavu/core`, both languages side by side: the
 * Brain (Jira) and the Sensor (Bitbucket) show the same diagnostic with the
 * same words, because the words live here and nowhere else.
 *
 * The tables are total (`Record<Enum, …>`) and every lookup still falls back:
 * the values reach the screens as JSON over `invoke()`, so an unexpected
 * string must render a label, not `undefined`.
 */

import type {
  Category,
  DiagnosticAction,
  DiagnosticKind,
  SignatureStatus,
} from '@dejavu/core';
import type { Lang } from './lang.js';

/** Colour token accepted by the UI Kit (`Tag`, `Lozenge`). */
export type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'grey' | 'purple';

/** One entry of a label table: english, french, colour. */
type Entry = [string, string, Tone];

/** Picks the label of an entry in the requested language. */
function label(entry: Entry, fallback: Entry, lang: Lang): string {
  return (lang === 'fr' ? entry[1] : entry[0]) ?? (lang === 'fr' ? fallback[1] : fallback[0]);
}

const DIAGNOSTICS: Record<DiagnosticKind, Entry> = {
  flaky: ['Known flaky failure', 'Instabilité connue', 'yellow'],
  'already-fixed': ['Already seen, already fixed', 'Déjà vu, déjà corrigé', 'green'],
  new: ['New failure', 'Nouvelle erreur', 'red'],
  infrastructure: ['Infrastructure problem', 'Problème d’infrastructure', 'purple'],
  uncertain: ['Uncertain', 'Incertain', 'grey'],
};

const ACTIONS: Record<DiagnosticAction, [string, string]> = {
  retry: ['Retry the build', 'Relancer le build'],
  rebase: ['Rebase or cherry-pick the fix', 'Rebaser ou reprendre le correctif'],
  fix: ['Fix it', 'Corriger'],
  wait: ['Wait and retry later', 'Attendre puis réessayer'],
  none: ['Nothing to do yet', 'Rien à faire pour l’instant'],
};

const STATUSES: Record<SignatureStatus, Entry> = {
  new: ['New', 'Nouvelle', 'blue'],
  known: ['Known', 'Connue', 'grey'],
  flaky: ['Flaky', 'Instable', 'yellow'],
  resolved: ['Resolved', 'Résolue', 'green'],
  regression: ['Regression', 'Régression', 'red'],
};

const CATEGORIES: Record<Category, [string, string]> = {
  test: ['Test', 'Test'],
  compile: ['Compile', 'Compilation'],
  style: ['Style', 'Style'],
  dependency: ['Dependency', 'Dépendance'],
  infrastructure: ['Infrastructure', 'Infrastructure'],
  timeout: ['Timeout', 'Délai'],
  config: ['Configuration', 'Configuration'],
  unknown: ['Unknown', 'Inconnue'],
};

/** The five diagnostics, in the order the engine evaluates them (§ 10). */
export const DIAGNOSTIC_KINDS: DiagnosticKind[] = [
  'flaky',
  'already-fixed',
  'new',
  'infrastructure',
  'uncertain',
];

/** The five signature statuses. */
export const SIGNATURE_STATUSES: SignatureStatus[] = [
  'new',
  'known',
  'flaky',
  'resolved',
  'regression',
];

/** The eight error categories (§ 9.4). */
export const CATEGORIES_LIST: Category[] = [
  'test',
  'compile',
  'style',
  'dependency',
  'infrastructure',
  'timeout',
  'config',
  'unknown',
];

/** Label of a diagnostic kind ("Known flaky failure"). */
export function diagnosticLabel(kind: DiagnosticKind, lang: Lang): string {
  const entry = DIAGNOSTICS[kind] ?? DIAGNOSTICS.uncertain;
  return label(entry, DIAGNOSTICS.uncertain, lang);
}

/** Colour of a diagnostic kind. */
export function diagnosticTone(kind: DiagnosticKind): Tone {
  return (DIAGNOSTICS[kind] ?? DIAGNOSTICS.uncertain)[2];
}

/** Label of the action proposed to the developer ("Retry the build"). */
export function actionLabel(action: DiagnosticAction, lang: Lang): string {
  const entry = ACTIONS[action] ?? ACTIONS.none;
  return (lang === 'fr' ? entry[1] : entry[0]) ?? ACTIONS.none[0];
}

/** Label of a signature status ("Flaky"). */
export function statusLabel(status: SignatureStatus, lang: Lang): string {
  const entry = STATUSES[status] ?? STATUSES.known;
  return label(entry, STATUSES.known, lang);
}

/** Colour of a signature status. */
export function statusTone(status: SignatureStatus): Tone {
  return (STATUSES[status] ?? STATUSES.known)[2];
}

/** True when the status asks the developer to do something (§ 14). */
export function statusNeedsAttention(status: SignatureStatus): boolean {
  return status === 'flaky' || status === 'regression';
}

/** Label of an error category ("Dependency"). */
export function categoryLabel(category: Category, lang: Lang): string {
  const entry = CATEGORIES[category] ?? CATEGORIES.unknown;
  return (lang === 'fr' ? entry[1] : entry[0]) ?? CATEGORIES.unknown[0];
}
