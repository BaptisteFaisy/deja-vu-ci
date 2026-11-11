/**
 * Screen strings of the Brain (§ 18 — "the interface exists in English and in
 * French").
 *
 * Only the keys **this app owns** are listed here: the strings both Forge apps
 * display (a diagnostic, an action, the pairing form) live in
 * `@dejavu/present`, so the Bitbucket card and the Jira screens say the same
 * words without a second copy of the table.
 *
 * The module is **pure**: no `@forge/react` import, so it is testable without
 * the UI Kit.
 */

import { LANGS, LANG_LABELS, normalizeLang, sharedMessage } from '@dejavu/present';
import type { Lang } from '@dejavu/present';

export { LANGS, LANG_LABELS, normalizeLang };
export type { Lang };

/** Table of the screen-specific translations: key → [english, french]. */
const TABLE: Record<string, [string, string]> = {
  'page.title': ['CI Memory', 'Mémoire de CI'],
  'page.subtitle': [
    'Failures already seen, with their diagnosis and their fix.',
    'Les échecs déjà vus, avec leur diagnostic et leur correctif.',
  ],
  'tab.signatures': ['Signatures', 'Signatures'],
  'tab.flaky': ['Flaky tests', 'Tests instables'],
  'tab.pending': ['Resolutions to confirm', 'Résolutions à confirmer'],
  'tab.cost': ['Cost', 'Coût'],
  'filter.status': ['Status', 'Statut'],
  'filter.category': ['Category', 'Catégorie'],
  'filter.search': ['Search a failure', 'Rechercher un échec'],
  'filter.all': ['All', 'Tous'],
  'column.signature': ['Signature', 'Signature'],
  'column.status': ['Status', 'Statut'],
  'column.category': ['Category', 'Catégorie'],
  'column.occurrences': ['Occurrences', 'Occurrences'],
  'column.lastSeen': ['Last seen', 'Dernière vue'],
  'column.firstSeen': ['First seen', 'Première vue'],
  'column.issue': ['Ticket', 'Ticket'],
  'column.test': ['Test', 'Test'],
  'column.repo': ['Repository', 'Dépôt'],
  'column.commit': ['Commit', 'Commit'],
  'column.author': ['Author', 'Auteur'],
  'column.minutes': ['CI minutes lost', 'Minutes de CI perdues'],
  'column.people': ['People affected', 'Personnes touchées'],
  'column.retries': ['Retries', 'Relances'],
  'empty.signatures': ['No failure recorded yet.', 'Aucun échec enregistré.'],
  'empty.flaky': ['No flaky test in this window.', 'Aucun test instable sur cette fenêtre.'],
  'empty.pending': ['No resolution to confirm.', 'Aucune résolution à confirmer.'],
  'empty.cost': ['No cost recorded yet.', 'Aucun coût enregistré.'],
  'issue.diagnostic': ['Last build of this branch', 'Dernier build de cette branche'],
  'issue.occurrences': ['Occurrences of this problem', 'Occurrences de ce problème'],
  'issue.confirm': ['Confirm', 'Confirmer'],
  'issue.reject': ['Reject', 'Rejeter'],
  'issue.unconfirmed': ['Waiting for a human confirmation', 'En attente de confirmation humaine'],
  'settings.project': ['Project where problem tickets are created', 'Projet où créer les tickets de problème'],
  'settings.flakyOccurrences': ['Minimum occurrences before a test is flaky', 'Occurrences minimales avant qu’un test soit instable'],
  'settings.flakyBranches': ['Minimum branches before a test is flaky', 'Branches minimales avant qu’un test soit instable'],
  'settings.flakyWindow': ['Flaky window (days)', 'Fenêtre d’instabilité (jours)'],
  'settings.retention': ['Raw excerpt retention (days)', 'Conservation des extraits bruts (jours)'],
  'settings.universalKey': ['Universal entry key', 'Clé de l’entrée universelle'],
  'settings.universalHint': [
    'The key a CI must send to push its own excerpt.',
    'La clé qu’une CI doit envoyer pour pousser son propre extrait.',
  ],
  'sample.button': ['Replay the sample set', 'Rejouer le jeu d’exemple'],
  'sample.running': ['Replaying the sample set…', 'Rejeu du jeu d’exemple…'],
  'sample.seeded': ['Sample set replayed: the memory is filled.', 'Jeu d’exemple rejoué : la mémoire est remplie.'],
  'sample.already': [
    'The memory already holds failures: nothing was injected.',
    'La mémoire contient déjà des échecs : rien n’a été injecté.',
  ],
  'sample.failed': ['The replay failed.', 'Le rejeu a échoué.'],
  'sample.signatures': ['Signatures', 'Signatures'],
  'sample.occurrences': ['Failures replayed', 'Échecs rejoués'],
  'sample.tickets': ['Tickets created', 'Tickets créés'],
  'sample.comments': ['Comments posted', 'Commentaires publiés'],
  'sample.kinds': ['Diagnostics', 'Diagnostics'],
  'curate.title': ['Curation', 'Curation'],
  'curate.merge': ['Merge', 'Fusionner'],
  'curate.split': ['Split', 'Scinder'],
  'curate.keep': ['Signature to keep', 'Signature à conserver'],
  'curate.drop': ['Signature to absorb', 'Signature à absorber'],
  'curate.criterion': ['Split criterion', 'Critère de scission'],
  'criterion.test-name': ['Test name', 'Nom du test'],
  'criterion.branch': ['Branch', 'Branche'],
  'criterion.repository': ['Repository', 'Dépôt'],
  'criterion.function': ['Step / function', 'Étape / fonction'],
  'curate.merged': ['Kept after merge', 'Conservée après fusion'],
  'curate.retired': ['Retired', 'Retirée'],
  'curate.moved': ['Occurrences reattached', 'Occurrences réaffectées'],
  'curate.groups': ['Groups', 'Groupes'],
  'curate.rule': ['Suggested normalization rule', 'Règle de normalisation suggérée'],
  'curate.rule.covered': ['Already covered by the normalizer', 'Déjà couverte par le normalisateur'],
  'curate.rule.uncovered': ['Not covered by the normalizer yet', 'Pas encore couverte par le normalisateur'],
  'curate.token': ['Token', 'Jeton'],
  'curate.pattern': ['Pattern', 'Motif'],
  'curate.replacement': ['Replacement', 'Remplacement'],
  'quarantine.title': ['Quarantine', 'Quarantaine'],
  'quarantine.button': ['Propose a quarantine', 'Proposer une quarantaine'],
  'quarantine.notFlaky': ['Not unstable — nothing proposed', 'Pas instable — rien proposé'],
  'quarantine.reasons': ['Why', 'Pourquoi'],
  'quarantine.snippet': ['Idiomatic snippet', 'Snippet idiomatique'],
  'quarantine.ecosystem': ['Ecosystem', 'Écosystème'],
  'quarantine.file': ['File', 'Fichier'],
  'quarantine.instruction': ['Instruction', 'Instruction'],
  'quarantine.ticket': ['Repair ticket', 'Ticket de réparation'],
  'quarantine.due': ['Due in (days)', 'Échéance (jours)'],
  'quarantine.assignee': ['Suggested owner', 'Propriétaire suggéré'],
  'quarantine.worthIt': ['Worth it', 'Cela vaut le coup'],
  'quarantine.notWorthIt': ['Not worth it', 'Ne vaut pas le coup'],
  'quarantine.thresholds': ['Thresholds', 'Seuils'],
  'quarantine.branches': ['Branches', 'Branches'],
  'quarantine.flakyIndex': ['Flaky index', 'Indice d’instabilité'],
  'quarantine.labels': ['Labels', 'Étiquettes'],
};

/**
 * Shared keys this app renders (the strings live in `@dejavu/present`).
 *
 * Listing them keeps the coverage of the interface visible from here without
 * copying a single word of the shared table.
 */
const SHARED_USED: string[] = [
  'common.loading',
  'diagnostic.none',
  'diagnostic.confidence',
  'diagnostic.action',
  'diagnostic.facts',
  'diagnostic.resolution',
  'diagnostic.signature',
  'diagnostic.lastFailure',
  'settings.title',
  'settings.save',
  'settings.saved',
  'settings.saveFailed',
  'cost.redBuilds',
  'cost.minutesLost',
  'cost.peopleAffected',
  'cost.retries',
  'cost.window',
];

/** Every key this app can translate: its own, then the shared ones it uses. */
export function translationKeys(): string[] {
  return [...Object.keys(TABLE), ...SHARED_USED];
}

/**
 * Translates a key in the requested language.
 *
 * The local table answers first, then the shared one: a key that belongs to
 * both apps is written once. An unknown key renders the key itself — a
 * missing translation degrades a label, it never breaks a screen.
 */
export function t(key: string, lang: Lang): string {
  const entry = TABLE[key];
  if (entry) return lang === 'fr' ? entry[1] : entry[0];
  return sharedMessage(key, lang) ?? key;
}
