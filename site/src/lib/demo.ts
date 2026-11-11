/**
 * La démo publique : le vrai moteur, le vrai jeu d'exemple, dans le navigateur.
 *
 * Ce module est **pur** (aucun DOM, aucun réseau) : il rejoue le jeu suivi par
 * git avec `replayWithEngine` sur une `MemoryStore`, puis met le résultat en
 * forme en modèles de vue stables que `site/src/render/` n'a plus qu'à placer.
 * C'est exactement le chemin du bouton « Rejouer le jeu d'exemple » de l'app
 * Jira (`apps/brain/src/seed.ts`), moins la Jira : ici les tickets restent un
 * **plan**, avec les clés fictives du rejeu.
 *
 * Rien n'est inventé, rien n'est rejoué à la main : `staticReplayEngine()` est
 * l'assembleur partagé du paquet core (le même que l'app Jira utilise).
 */

import {
  MemoryStore,
  computeCost,
  replayWithEngine,
  signatureShort,
  staticReplayEngine,
  type Category,
  type Diagnostic,
  type DiagnosticAction,
  type DiagnosticFact,
  type DiagnosticKind,
  type Occurrence,
  type SampleDataset,
  type SignatureStatus,
  type TicketActionKind,
} from '@dejavu/core';
import dataset from '../../../data/sample/occurrences.json';

/** Le jeu d'exemple suivi par git (`data/sample/occurrences.json`). */
export const SAMPLE = dataset as unknown as SampleDataset;

/** Marge ajoutée à la fenêtre du jeu pour que le coût voie tout le corpus. */
const WINDOW_MARGIN_DAYS = 7;

/** Un diagnostic, avec le build qui l'a produit. */
export interface DemoDiagnostic {
  at: string;
  repo: string;
  branch: string;
  commit: string;
  author: string;
  step: string;
  kind: DiagnosticKind;
  confidence: number;
  title: string;
  summary: string;
  action: DiagnosticAction;
  facts: DiagnosticFact[];
  signature: string;
  issueKey?: string;
}

/** Une signature de la mémoire. */
export interface DemoSignature {
  id: string;
  shortId: string;
  familyId: string;
  category: Category;
  status: SignatureStatus;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  testName?: string;
  issueKey?: string;
}

/** Une action du plan de tickets (§ 11). */
export interface DemoTicket {
  kind: TicketActionKind;
  familyId: string;
  summary: string;
  issueKey?: string;
  comment?: string;
}

/** Le coût, et les signatures qui coûtent le plus. */
export interface DemoCost {
  redBuilds: number;
  ciMinutesLost: number;
  peopleAffected: number;
  retries: number;
  windowDays: number;
  top: Array<{ signature: string; title: string; occurrences: number; ciMinutesLost: number }>;
}

/** Tout ce que la page affiche après un rejeu. */
export interface DemoRun {
  datasetName: string;
  days: number;
  repositories: string[];
  failures: number;
  elapsedMs: number;
  byKind: Record<DiagnosticKind, number>;
  diagnostics: DemoDiagnostic[];
  signatures: DemoSignature[];
  tickets: DemoTicket[];
  cost: DemoCost;
}

/**
 * L'horloge de la démo : le lendemain du dernier build du jeu.
 *
 * Le coût se calcule sur une fenêtre glissante ; sans cette date fixe, un
 * visiteur qui revient dans six mois verrait une fenêtre vide. La démo ne
 * dépend donc jamais de l'heure réelle.
 */
export function demoNow(set: SampleDataset = SAMPLE): Date {
  const last = set.occurrences.reduce((max, o) => (o.at > max ? o.at : max), '');
  return new Date(Date.parse(last) + 24 * 3600 * 1000);
}

/** Les dépôts du jeu, triés (le jeu en couvre plusieurs, § 10.4). */
export function repositoriesOf(set: SampleDataset = SAMPLE): string[] {
  return [...new Set(set.occurrences.map((o) => o.repo))].sort();
}

/** Le modèle de vue d'un diagnostic : le build qui l'a produit, et sa décision. */
function toDemoDiagnostic(occurrence: Occurrence, diagnostic: Diagnostic): DemoDiagnostic {
  return {
    at: occurrence.occurredAt,
    repo: occurrence.repo,
    branch: occurrence.branch,
    commit: occurrence.commit,
    author: occurrence.author,
    step: occurrence.stepName,
    kind: diagnostic.kind,
    confidence: diagnostic.confidence,
    title: diagnostic.title,
    summary: diagnostic.summary,
    action: diagnostic.action,
    facts: diagnostic.facts,
    signature: diagnostic.signatureShort,
    ...(diagnostic.issueKey ? { issueKey: diagnostic.issueKey } : {}),
  };
}

/**
 * Rejoue le jeu d'exemple avec le vrai moteur et met le résultat en forme.
 *
 * Une seule fonction publique : la page l'appelle, les tests l'appellent, et
 * personne d'autre n'a besoin de savoir comment le moteur est assemblé.
 */
export async function runDemo(now: Date = demoNow()): Promise<DemoRun> {
  const store = new MemoryStore();
  const result = await replayWithEngine(SAMPLE, staticReplayEngine(), { store, now });
  const occurrences = result.diagnostics.map((entry) => entry.occurrence);
  const cost = computeCost(occurrences, {
    signatures: result.signatures,
    now,
    windowDays: SAMPLE.days + WINDOW_MARGIN_DAYS,
  });
  return {
    datasetName: result.datasetName,
    days: SAMPLE.days,
    repositories: repositoriesOf(),
    failures: result.occurrences,
    elapsedMs: result.elapsedMs,
    byKind: result.byKind,
    diagnostics: result.diagnostics.map(({ occurrence, diagnostic }) =>
      toDemoDiagnostic(occurrence, diagnostic),
    ),
    signatures: result.signatures.map((signature) => ({
      id: signature.id,
      shortId: signatureShort(signature.id),
      familyId: signature.familyId,
      category: signature.category,
      status: signature.status,
      occurrences: signature.occurrences,
      firstSeen: signature.firstSeen,
      lastSeen: signature.lastSeen,
      ...(signature.testName ? { testName: signature.testName } : {}),
      ...(signature.issueKey ? { issueKey: signature.issueKey } : {}),
    })),
    tickets: result.tickets.map((action) => ({
      kind: action.kind,
      familyId: action.familyId,
      summary: action.summary,
      ...(action.issueKey ? { issueKey: action.issueKey } : {}),
      ...(action.comment ? { comment: action.comment } : {}),
    })),
    cost: {
      redBuilds: cost.redBuilds,
      ciMinutesLost: cost.ciMinutesLost,
      peopleAffected: cost.peopleAffected,
      retries: cost.retries,
      windowDays: cost.windowDays,
      top: cost.perSignature.slice(0, 5).map((row) => ({
        signature: row.signatureShort,
        title: row.title,
        occurrences: row.occurrences,
        ciMinutesLost: row.ciMinutesLost,
      })),
    },
  };
}
