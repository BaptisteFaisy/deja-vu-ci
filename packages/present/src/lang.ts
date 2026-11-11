/**
 * Language handling and the strings the two Forge apps share (§ 18:
 * "the interface exists in English and in French").
 *
 * Pure module: no Forge, no React, no `node:*` import. Both the Brain (Jira)
 * and the Sensor (Bitbucket) render through it, so a label written here is
 * written once — the apps keep only their own screen-specific keys.
 */

/** The two languages of the interface. */
export type Lang = 'en' | 'fr';

/** Available languages, in the order the settings screen lists them. */
export const LANGS: Lang[] = ['en', 'fr'];

/** Name of a language, in that language. */
export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  fr: 'Français',
};

/** Normalises a language coming from a browser locale or from a setting. */
export function normalizeLang(value: unknown): Lang {
  return typeof value === 'string' && value.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** The other language — what the language button switches to. */
export function otherLang(lang: Lang): Lang {
  return lang === 'fr' ? 'en' : 'fr';
}

/** Label of the language button: it names the language it switches to. */
export function langToggleLabel(lang: Lang): string {
  return LANG_LABELS[otherLang(lang)];
}

/**
 * Strings shared by the two apps: key → [english, french].
 *
 * Anything a single screen owns stays in that app's own table; anything both
 * apps display (a diagnostic, an action, the pairing form) lives here.
 */
const MESSAGES: Record<string, [string, string]> = {
  'common.loading': ['Loading…', 'Chargement…'],
  'common.language': ['Language', 'Langue'],
  'error.title': ['The diagnostic could not be loaded.', 'Le diagnostic n’a pas pu être chargé.'],
  'error.notPaired': [
    'This workspace is not paired with a Brain yet.',
    'Cet espace de travail n’est pas encore jumelé à un Cerveau.',
  ],
  'diagnostic.none': [
    'No known failure on this branch.',
    'Aucun échec connu sur cette branche.',
  ],
  'diagnostic.confidence': ['Confidence', 'Confiance'],
  'diagnostic.action': ['Suggested action', 'Action proposée'],
  'diagnostic.facts': ['Facts', 'Faits'],
  'diagnostic.evidence': ['What was seen', 'Éléments constatés'],
  'diagnostic.ticket': ['Ticket', 'Ticket'],
  'diagnostic.resolution': ['Resolution', 'Résolution'],
  'diagnostic.suspects': ['Changed files in the stack', 'Fichiers modifiés présents dans la pile'],
  'diagnostic.signature': ['Signature', 'Signature'],
  'diagnostic.lastFailure': ['Last failure', 'Dernier échec'],
  'diagnostic.noMatch': ['No failure matched this build yet.', 'Aucun échec ne correspond encore à ce build.'],
  'settings.title': ['Déjà-vu CI settings', 'Réglages Déjà-vu CI'],
  'settings.brainUrl': ['Brain URL (web trigger)', 'URL du Cerveau (web trigger)'],
  'settings.secret': ['Shared secret', 'Secret partagé'],
  'settings.secretHint': [
    'Sent once at pairing time, stored as a Forge secret, never displayed again.',
    'Envoyé une fois au jumelage, rangé comme secret Forge, jamais réaffiché.',
  ],
  'settings.paired': ['Paired with a Brain', 'Jumelé avec un Cerveau'],
  'settings.notPaired': ['Not paired yet', 'Pas encore jumelé'],
  'settings.trackedRepositories': [
    'Watched repositories (workspace/repository, one per line)',
    'Dépôts suivis (espace/dépôt, un par ligne)',
  ],
  'settings.maxExcerpt': ['Maximum excerpt size', 'Taille maximale des extraits'],
  'settings.save': ['Save', 'Enregistrer'],
  'settings.saved': ['Settings saved.', 'Réglages enregistrés.'],
  'settings.saveFailed': [
    'Settings could not be saved.',
    'Les réglages n’ont pas pu être enregistrés.',
  ],
  'settings.error.brainUrlRequired': [
    'The Brain URL is required.',
    'L’URL du Cerveau est requise.',
  ],
  'settings.error.brainUrlInvalid': [
    'The Brain URL is not a valid http(s) address.',
    'L’URL du Cerveau n’est pas une adresse http(s) valide.',
  ],
  'settings.error.secretTooShort': [
    'The shared secret must be at least 16 characters long.',
    'Le secret partagé doit compter au moins 16 caractères.',
  ],
  // Cost (§ 14, CI-14): the same five numbers are displayed by the Brain's
  // Cost tab and by the public site's in-browser demo — one table, not two.
  'cost.redBuilds': ['Red builds', 'Builds rouges'],
  'cost.minutesLost': ['CI minutes lost', 'Minutes de CI perdues'],
  'cost.peopleAffected': ['People affected', 'Personnes touchées'],
  'cost.retries': ['Retries', 'Relances'],
  'cost.window': ['Window (days)', 'Fenêtre (jours)'],
};

/** Keys of the shared table — an app lists them with its own keys. */
export function sharedKeys(): string[] {
  return Object.keys(MESSAGES);
}

/** Shared string of a key, or `undefined` when the key is not shared. */
export function sharedMessage(key: string, lang: Lang): string | undefined {
  const entry = MESSAGES[key];
  if (!entry) return undefined;
  return lang === 'fr' ? entry[1] : entry[0];
}

/**
 * Translates a shared key.
 *
 * An unknown key renders the key itself: a missing translation degrades the
 * label, it never breaks a screen.
 */
export function t(key: string, lang: Lang): string {
  return sharedMessage(key, lang) ?? key;
}
