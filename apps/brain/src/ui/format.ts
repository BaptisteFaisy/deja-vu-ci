/**
 * Mise en forme des écrans du Cerveau (§ 14) — module **pur**.
 *
 * Tout ce qui transforme des données en libellés, en couleurs, en tris et en
 * filtres vit ici : pas de JSX, pas d'import `@forge/react`, pas d'accès
 * réseau. Les composants `.tsx` ne font que placer ces valeurs.
 */

import type {
  Category,
  CostReport,
  Occurrence,
  Signature,
  SignatureStatus,
} from '@dejavu/core';

/** Langues de l'interface (§ 18). */
export type Lang = 'en' | 'fr';

/** Statut affiché avec sa couleur (jetons Atlassian, pas de classes CSS). */
export interface StatusBadge {
  label: string;
  /** Jeton de couleur : `green`, `yellow`, `red`, `blue`, `grey`, `purple`. */
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'grey' | 'purple';
  /** Vrai si la signature demande une action du développeur. */
  attention: boolean;
}

/** Libellé et couleur d'un statut de signature. */
export function statusBadge(status: SignatureStatus, lang: Lang): StatusBadge {
  const en: Record<SignatureStatus, [string, StatusBadge['tone']]> = {
    new: ['New', 'blue'],
    known: ['Known', 'grey'],
    flaky: ['Flaky', 'yellow'],
    resolved: ['Resolved', 'green'],
    regression: ['Regression', 'red'],
  };
  const fr: Record<SignatureStatus, [string, StatusBadge['tone']]> = {
    new: ['Nouvelle', 'blue'],
    known: ['Connue', 'grey'],
    flaky: ['Instable', 'yellow'],
    resolved: ['Résolue', 'green'],
    regression: ['Régression', 'red'],
  };
  const table = lang === 'fr' ? fr : en;
  const [label, tone] = table[status] ?? en[status];
  return { label, tone, attention: status === 'flaky' || status === 'regression' };
}

/** Libellé d'une catégorie d'erreur. */
export function categoryLabel(category: Category, lang: Lang): string {
  const en: Record<Category, string> = {
    test: 'Test',
    compile: 'Compile',
    style: 'Style',
    dependency: 'Dependency',
    infrastructure: 'Infrastructure',
    timeout: 'Timeout',
    config: 'Configuration',
    unknown: 'Unknown',
  };
  const fr: Record<Category, string> = {
    test: 'Test',
    compile: 'Compilation',
    style: 'Style',
    dependency: 'Dépendance',
    infrastructure: 'Infrastructure',
    timeout: 'Délai',
    config: 'Configuration',
    unknown: 'Inconnue',
  };
  return (lang === 'fr' ? fr : en)[category] ?? en[category];
}

/** Filtres de la page « Mémoire de CI ». */
export interface SignatureFilter {
  status?: SignatureStatus;
  category?: Category;
  /** Recherche libre sur le gabarit, le type d'erreur et le nom du test. */
  text?: string;
  repository?: string;
}

/** Une ligne du tableau des signatures. */
export interface SignatureRow {
  id: string;
  shortId: string;
  status: SignatureStatus;
  badge: StatusBadge;
  category: Category;
  categoryLabel: string;
  errorType: string;
  template: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  issueKey?: string;
}

/** Champs de tri du tableau des signatures. */
export type SignatureSortKey = 'lastSeen' | 'occurrences' | 'status' | 'category';

/** Prépare les lignes du tableau à partir des signatures. */
export function toSignatureRows(
  signatures: Signature[],
  shortId: (id: string) => string,
  lang: Lang,
): SignatureRow[] {
  return signatures.map((signature) => ({
    id: signature.id,
    shortId: shortId(signature.id),
    status: signature.status,
    badge: statusBadge(signature.status, lang),
    category: signature.category,
    categoryLabel: categoryLabel(signature.category, lang),
    errorType: signature.errorType,
    template: signature.template,
    occurrences: signature.occurrences,
    firstSeen: signature.firstSeen,
    lastSeen: signature.lastSeen,
    issueKey: signature.issueKey,
  }));
}

/** Une ligne de recherche est retenue si elle contient le texte cherché. */
function matchesText(row: SignatureRow, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [row.template, row.errorType, row.shortId, row.issueKey ?? '']
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

/** Applique les filtres de la page projet. */
export function filterSignatureRows(
  rows: SignatureRow[],
  filter: SignatureFilter,
): SignatureRow[] {
  return rows.filter((row) => {
    if (filter.status && row.status !== filter.status) return false;
    if (filter.category && row.category !== filter.category) return false;
    return matchesText(row, filter.text ?? '');
  });
}

/** Compare deux lignes selon une clé de tri. */
function compareRows(a: SignatureRow, b: SignatureRow, key: SignatureSortKey): number {
  switch (key) {
    case 'occurrences':
      return b.occurrences - a.occurrences;
    case 'status':
      return a.status.localeCompare(b.status);
    case 'category':
      return a.category.localeCompare(b.category);
    case 'lastSeen':
    default:
      return a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0;
  }
}

/** Trie les lignes du tableau (tri stable, la dernière vue d'abord). */
export function sortSignatureRows(
  rows: SignatureRow[],
  key: SignatureSortKey,
  descending = false,
): SignatureRow[] {
  const sorted = [...rows].sort((a, b) => compareRows(a, b, key));
  return descending ? sorted.reverse() : sorted;
}

/** Une ligne du tableau des occurrences. */
export interface OccurrenceRow {
  occurredAt: string;
  repo: string;
  branch: string;
  commit: string;
  author: string;
  stepName: string;
  durationS: number;
  buildUrl?: string;
}

/** Prépare les lignes d'occurrences, de la plus récente à la plus ancienne. */
export function toOccurrenceRows(occurrences: Occurrence[]): OccurrenceRow[] {
  return [...occurrences]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .map((occurrence) => ({
      occurredAt: occurrence.occurredAt,
      repo: occurrence.repo,
      branch: occurrence.branch,
      commit: occurrence.commit,
      author: occurrence.author,
      stepName: occurrence.stepName,
      durationS: occurrence.durationS,
      buildUrl: occurrence.buildUrl,
    }));
}

/** Une ligne de l'onglet « Coût ». */
export interface CostRow {
  signatureId: string;
  shortId: string;
  title: string;
  occurrences: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
}

/** Prépare les lignes de l'onglet « Coût », de la plus coûteuse à la moins chère. */
export function toCostRows(
  report: CostReport,
  shortId: (id: string) => string,
): CostRow[] {
  return report.perSignature.map((cost) => ({
    signatureId: cost.signatureId,
    shortId: shortId(cost.signatureId),
    title: cost.title,
    occurrences: cost.occurrences,
    ciMinutesLost: cost.ciMinutesLost,
    peopleAffected: cost.peopleAffected,
    retries: cost.retries,
  }));
}

/** Formate une durée en minutes pour l'affichage. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.round((seconds / 60) * 10) / 10;
  return `${minutes} min`;
}

/** Formate une date ISO en date lisible (JJ/MM/AAAA ou MM/DD/YYYY). */
export function formatDate(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return lang === 'fr' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
}

/** Abrège un commit pour l'affichage. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}
