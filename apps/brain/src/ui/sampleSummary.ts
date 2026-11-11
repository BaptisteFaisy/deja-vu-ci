/**
 * Mise en forme du résumé d'un rejeu (§ 22, CI-11) — module **pur**.
 *
 * Le composant `sampleReplay.tsx` ne fait que placer ces chaînes : les textes
 * viennent de `i18n.ts` (les deux langues, § 18) et les compteurs du Cerveau
 * (`src/seed.ts`). Aucune dépendance à `@forge/react` ici, donc testable.
 */

import { t, type Lang } from './i18n';

/** Ce que le Cerveau répond à l'appel `replay-sample`. */
export interface ReplaySummaryView {
  ok: boolean;
  /** Faux quand la mémoire contenait déjà des signatures : rien n'est injecté. */
  seeded?: boolean;
  signatures?: number;
  occurrences?: number;
  ticketsCreated?: number;
  comments?: number;
  byKind?: Record<string, number>;
  error?: string;
}

/** Les quatre états du bouton. */
export type ReplayState = 'idle' | 'running' | 'done' | 'failed';

/** Les compteurs du résumé, dans l'ordre d'affichage. */
export function summaryCounters(
  summary: ReplaySummaryView,
  lang: Lang,
): Array<{ label: string; value: number }> {
  return [
    { label: t('sample.signatures', lang), value: summary.signatures ?? 0 },
    { label: t('sample.occurrences', lang), value: summary.occurrences ?? 0 },
    { label: t('sample.tickets', lang), value: summary.ticketsCreated ?? 0 },
    { label: t('sample.comments', lang), value: summary.comments ?? 0 },
  ];
}

/** Les diagnostics produits, seuls ceux qui comptent au moins une occurrence. */
export function kindCounts(summary: ReplaySummaryView): Array<{ kind: string; count: number }> {
  return Object.entries(summary.byKind ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([kind, count]) => ({ kind, count }));
}

/** Une ligne de compteurs : « Signatures: 12 · Failures replayed: 40 ». */
export function summaryLine(summary: ReplaySummaryView, lang: Lang): string {
  const parts = summaryCounters(summary, lang).map(({ label, value }) => `${label}: ${value}`);
  const kinds = kindCounts(summary);
  if (kinds.length > 0) {
    parts.push(`${t('sample.kinds', lang)}: ${kinds.map((k) => `${k.kind} ${k.count}`).join(', ')}`);
  }
  return parts.join(' · ');
}

/**
 * Le texte d'état du bouton : ce qui s'est passé, dans la langue de l'écran.
 * Une chaîne vide quand il n'y a rien à dire (bouton au repos).
 */
export function statusText(
  state: ReplayState,
  summary: ReplaySummaryView | undefined,
  error: string | undefined,
  lang: Lang,
): string {
  if (state === 'running') return t('sample.running', lang);
  if (state === 'failed') {
    const reason = error ?? summary?.error ?? '';
    return `${t('sample.failed', lang)}${reason ? ` ${reason}` : ''}`.trim();
  }
  if (state === 'done' && summary) {
    return summary.seeded ? t('sample.seeded', lang) : t('sample.already', lang);
  }
  return '';
}
