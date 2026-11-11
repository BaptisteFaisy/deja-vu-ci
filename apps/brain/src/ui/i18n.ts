/**
 * Traductions de l'interface (§ 18 — « Interface en anglais et en français »).
 *
 * Les libellés passent tous par cette table : deux langues, un seul jeu de
 * clés, aucune chaîne en dur dans les composants. Le module est **pur** : pas
 * d'import `@forge/react`, donc testable sans le UI Kit.
 */

/** Langues supportées. */
export type Lang = 'en' | 'fr';

/** Langues disponibles, dans l'ordre d'affichage du réglage. */
export const LANGS: Lang[] = ['en', 'fr'];

/** Libellé d'une langue dans elle-même. */
export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  fr: 'Français',
};

/** Table des traductions : clé → [anglais, français]. */
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
  'cost.redBuilds': ['Red builds', 'Builds rouges'],
  'cost.minutesLost': ['CI minutes lost', 'Minutes de CI perdues'],
  'cost.peopleAffected': ['People affected', 'Personnes touchées'],
  'cost.retries': ['Retries', 'Relances'],
  'cost.window': ['Window (days)', 'Fenêtre (jours)'],
  'issue.diagnostic': ['Last build of this branch', 'Dernier build de cette branche'],
  'issue.occurrences': ['Occurrences of this problem', 'Occurrences de ce problème'],
  'issue.noFailure': ['No known failure on this branch.', 'Aucun échec connu sur cette branche.'],
  'issue.resolution': ['Resolution', 'Résolution'],
  'issue.confirm': ['Confirm', 'Confirmer'],
  'issue.reject': ['Reject', 'Rejeter'],
  'issue.unconfirmed': ['Waiting for a human confirmation', 'En attente de confirmation humaine'],
  'settings.title': ['Déjà-vu CI settings', 'Réglages Déjà-vu CI'],
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
  'settings.save': ['Save', 'Enregistrer'],
  'settings.saved': ['Settings saved.', 'Réglages enregistrés.'],
  'settings.saveFailed': ['Settings could not be saved.', 'Les réglages n’ont pas pu être enregistrés.'],
  'action.explain': ['Explain this failure', 'Expliquer cet échec'],
  'action.retry': ['Retry the build', 'Relancer le build'],
  'action.rebase': ['Rebase or cherry-pick the fix', 'Rebaser ou reprendre le correctif'],
  'action.fix': ['Fix it', 'Corriger'],
  'action.wait': ['Wait and retry later', 'Attendre puis réessayer'],
  'action.none': ['Nothing to do yet', 'Rien à faire pour l’instant'],
  'diagnosis.flaky': ['Known flaky failure', 'Instabilité connue'],
  'diagnosis.alreadyFixed': ['Already seen, already fixed', 'Déjà vu, déjà corrigé'],
  'diagnosis.new': ['New failure', 'Nouvelle erreur'],
  'diagnosis.infrastructure': ['Infrastructure problem', 'Problème d’infrastructure'],
  'diagnosis.uncertain': ['Uncertain', 'Incertain'],
  'confidence': ['Confidence', 'Confiance'],
};

/** Clés de traduction connues. */
export function translationKeys(): string[] {
  return Object.keys(TABLE);
}

/**
 * Traduit une clé dans la langue demandée.
 * Une clé inconnue rend la clé elle-même : l'interface ne casse jamais.
 */
export function t(key: string, lang: Lang): string {
  const entry = TABLE[key];
  if (!entry) return key;
  return lang === 'fr' ? entry[1] : entry[0];
}

/** Normalise une langue venue du navigateur ou d'un réglage. */
export function normalizeLang(value: unknown): Lang {
  return typeof value === 'string' && value.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
