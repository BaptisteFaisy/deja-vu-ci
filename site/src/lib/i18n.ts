/**
 * Les textes du site public, en anglais et en français (§ 18).
 *
 * Deux sources, aucune duplication :
 *  - ce qui appartient au **produit** (le nom d'un diagnostic, d'un statut,
 *    d'une catégorie, d'une action, le format d'une date ou d'une confiance)
 *    vient de `@dejavu/present` — la même table que la carte de PR Bitbucket et
 *    les écrans Jira ;
 *  - ce qui appartient au **site** (le titre, le bouton, les en-têtes de
 *    tableaux, la section « ce que cette page prouve ») vit dans la table
 *    ci-dessous.
 *
 * Module pur : aucune dépendance au DOM, donc testable.
 */

import { LANGS, LANG_LABELS, normalizeLang, otherLang, langToggleLabel, t as sharedT } from '@dejavu/present';
import type { Lang } from '@dejavu/present';

export { LANGS, LANG_LABELS, normalizeLang, otherLang, langToggleLabel };
export type { Lang };

/** Textes du site : clé → [anglais, français]. */
const TABLE: Record<string, [string, string]> = {
  'nav.demo': ['Live demo', 'Démo en direct'],
  'nav.how': ['How it works', 'Comment ça marche'],
  'nav.judges': ["Judges' guide", 'Guide des juges'],
  'nav.repo': ['Source code', 'Code source'],

  'hero.title': ['Build failures, with a memory.', 'Des builds rouges, avec une mémoire.'],
  'hero.pitch': [
    'Déjà-vu CI recognises a red build, tells in seconds whether it is new, known, flaky or an ' +
      'infrastructure failure, and keeps one Jira ticket per problem — never one per occurrence.',
    'Déjà-vu CI reconnaît un build rouge, dit en quelques secondes s’il est nouveau, connu, ' +
      'instable ou une panne d’infrastructure, et garde un ticket Jira par problème — jamais un ' +
      'par occurrence.',
  ],
  'hero.cta': ['Replay the sample set', 'Rejouer le jeu d’exemple'],
  'hero.secondary': ['Read the judges’ guide', 'Lire le guide des juges'],
  'hero.note': [
    'Runs the real engine in your browser: 40 failures over 14 days, on a fictional payments ' +
      'monorepo. No account, no server, nothing leaves this page.',
    'Fait tourner le vrai moteur dans votre navigateur : 40 échecs sur 14 jours, sur un monorepo ' +
      'de paiement fictif. Sans compte, sans serveur, rien ne quitte cette page.',
  ],

  'demo.title': ['The memory, filled in one click', 'La mémoire, remplie en un clic'],
  'demo.description': [
    'The same replay the Jira app runs when a judge clicks its button: extraction, signature, ' +
      'diagnosis, ticket plan and cost — the real `packages/core`, the real sample dataset.',
    'Le même rejeu que l’app Jira exécute quand un juge clique sur son bouton : extraction, ' +
      'signature, diagnostic, plan de tickets et coût — le vrai `packages/core`, le vrai jeu ' +
      'd’exemple.',
  ],
  'demo.running': ['Replaying 40 failures…', 'Rejeu de 40 échecs…'],
  'demo.done': ['Replayed in {ms} ms — everything below was computed in your browser.',
    'Rejoué en {ms} ms — tout ce qui suit a été calculé dans votre navigateur.'],
  'demo.error': ['The replay failed: {error}', 'Le rejeu a échoué : {error}'],
  'demo.dataset': ['Dataset {name} — {days} days, {repos} repositories, {failures} failures.',
    'Jeu {name} — {days} jours, {repos} dépôts, {failures} échecs.'],

  'counter.signatures': ['Signatures', 'Signatures'],
  'counter.failures': ['Failures replayed', 'Échecs rejoués'],
  'counter.tickets': ['Tickets planned', 'Tickets planifiés'],
  'counter.comments': ['Comments planned', 'Commentaires planifiés'],
  // Les cinq libellés de coût (`cost.*`) viennent de la table partagée de
  // `@dejavu/present` : l'onglet Coût du Cerveau et cette page disent la même
  // chose, sans deuxième copie.

  'results.diagnostics': ['Diagnostics', 'Diagnostics'],
  'results.diagnostics.note': [
    'One row per failure: what the engine decided, how sure it is, the facts behind it and the ' +
      'action it recommends. The facts are always shown (§ 18).',
    'Une ligne par échec : ce que le moteur a tranché, sa confiance, les faits qui le justifient ' +
      'et l’action recommandée. Les faits sont toujours montrés (§ 18).',
  ],
  'results.signatures': ['Signatures', 'Signatures'],
  'results.signatures.note': [
    'Failures grouped by what they are, not by how they phrase it: one signature, one family, one ' +
      'ticket.',
    'Les échecs regroupés par ce qu’ils sont, pas par leur formulation : une signature, une ' +
      'famille, un ticket.',
  ],
  'results.tickets': ['Ticket plan', 'Plan de tickets'],
  'results.tickets.note': [
    'What the app would do in Jira. One ticket per family, at most one synthesis comment per day ' +
      'and per ticket (§ 11).',
    'Ce que l’app ferait dans Jira. Un ticket par famille, au plus un commentaire de synthèse par ' +
      'jour et par ticket (§ 11).',
  ],
  'results.cost': ['What it costs', 'Ce que ça coûte'],
  'results.cost.note': [
    'CI minutes lost, people affected, retries — over the window of the sample set.',
    'Minutes de CI perdues, personnes touchées, relances — sur la fenêtre du jeu d’exemple.',
  ],
  'results.empty': ['Run the replay to fill this table.', 'Lance le rejeu pour remplir ce tableau.'],

  'col.time': ['When', 'Quand'],
  'col.where': ['Repository / branch', 'Dépôt / branche'],
  'col.commit': ['Commit', 'Commit'],
  'col.kind': ['Diagnostic', 'Diagnostic'],
  'col.confidence': ['Confidence', 'Confiance'],
  'col.action': ['Action', 'Action'],
  'col.signature': ['Signature', 'Signature'],
  'col.category': ['Category', 'Catégorie'],
  'col.status': ['Status', 'Statut'],
  'col.occurrences': ['Occurrences', 'Occurrences'],
  'col.firstSeen': ['First seen', 'Première vue'],
  'col.lastSeen': ['Last seen', 'Dernière vue'],
  'col.ticket': ['Ticket', 'Ticket'],
  'col.test': ['Test', 'Test'],
  'col.kindOfAction': ['Kind', 'Type'],
  'col.summary': ['Summary', 'Résumé'],
  'col.top': ['Most expensive signatures', 'Signatures les plus coûteuses'],

  'kinds.title': ['Four diagnostics, and one honest fallback', 'Quatre diagnostics, et un repli honnête'],
  'kinds.note': [
    'Every failure gets one of these. When the memory cannot decide, it says “uncertain” rather ' +
      'than guessing — and it never blames a developer without facts.',
    'Chaque échec reçoit l’un de ces diagnostics. Quand la mémoire ne peut pas trancher, elle dit ' +
      '« incertain » plutôt que de deviner — et elle ne met jamais un développeur en cause sans faits.',
  ],
  'kind.flaky': ['The same test fails and passes at the same commit, on several branches. Action: retry, and track the flakiness cost.',
    'Le même test échoue puis passe au même commit, sur plusieurs branches. Action : relancer, et suivre le coût de l’instabilité.'],
  'kind.already-fixed': ['A confirmed resolution exists and this branch does not contain it yet. Action: rebase.',
    'Une résolution confirmée existe et cette branche ne la contient pas encore. Action : rebaser.'],
  'kind.new': ['First appearance of this signature. Action: fix — and the suspects are the changed files present in the stack.',
    'Première apparition de cette signature. Action : corriger — les suspects sont les fichiers modifiés présents dans la pile.'],
  'kind.infrastructure': ['Several repositories fail the same way at the same time. Action: wait, it is not your code.',
    'Plusieurs dépôts échouent de la même façon au même moment. Action : attendre, ce n’est pas votre code.'],
  'kind.uncertain': ['Not enough evidence. The app says so, shows what it has, and never invents a cause.',
    'Pas assez d’éléments. L’app le dit, montre ce qu’elle a, et n’invente jamais de cause.'],

  'how.title': ['How it works', 'Comment ça marche'],
  'how.note': [
    'Two Forge apps and one engine. The Sensor watches Bitbucket, the Brain remembers everything ' +
      'in Jira, and the engine in between has no dependency on either platform.',
    'Deux apps Forge et un moteur. Le Capteur surveille Bitbucket, le Cerveau mémorise tout dans ' +
      'Jira, et le moteur entre les deux ne dépend d’aucune des deux plateformes.',
  ],
  'how.s1.title': ['A build goes red', 'Un build passe au rouge'],
  'how.s1.text': ['The Sensor (Bitbucket) reads the step log and the test report of the failing build.',
    'Le Capteur (Bitbucket) lit le journal d’étape et le rapport de tests du build en échec.'],
  'how.s2.title': ['Secrets are masked at the door', 'Les secrets sont masqués à l’entrée'],
  'how.s2.text': ['21 patterns (tokens, keys, passwords, emails) are erased before anything is stored or sent.',
    '21 motifs (jetons, clés, mots de passe, adresses) sont effacés avant tout stockage ou envoi.'],
  'how.s3.title': ['The payload is signed', 'La charge utile est signée'],
  'how.s3.text': ['HMAC, nonce and time window: the Brain only accepts what its paired Sensor sent.',
    'HMAC, nonce et fenêtre de temps : le Cerveau n’accepte que ce que son Capteur appairé a envoyé.'],
  'how.s4.title': ['The Brain decides', 'Le Cerveau tranche'],
  'how.s4.text': ['Extraction, normalisation, signature, diagnostic — then one ticket per family, and one comment a day at most.',
    'Extraction, normalisation, signature, diagnostic — puis un ticket par famille, et un commentaire par jour au plus.'],
  'how.s5.title': ['Developers ask, in their tools', 'Les développeurs demandent, dans leurs outils'],
  'how.s5.text': ['A Rovo agent and six MCP actions answer “have we seen this before?” with facts and the fix that worked.',
    'Un agent Rovo et six actions MCP répondent à « on a déjà vu ça ? » avec les faits et le correctif qui a marché.'],

  'honesty.title': ['What this page proves — and what it does not', 'Ce que cette page prouve — et ce qu’elle ne prouve pas'],
  'honesty.here': ['Runs here, in your browser:', 'Tourne ici, dans votre navigateur :'],
  'honesty.here1': ['the real engine (`packages/core`), unmodified, bundled for the web;',
    'le vrai moteur (`packages/core`), non modifié, bundlé pour le web ;'],
  'honesty.here2': ['the real sample dataset tracked by git (40 failures, 14 days, 3 repositories);',
    'le vrai jeu d’exemple suivi par git (40 échecs, 14 jours, 3 dépôts) ;'],
  'honesty.here3': ['the diagnostic, the ticket plan and the cost, exactly as the apps compute them.',
    'le diagnostic, le plan de tickets et le coût, exactement comme les apps les calculent.'],
  'honesty.not': ['Needs a real tenant (and is not simulated here):', 'Nécessite un vrai tenant (non simulé ici) :'],
  'honesty.not1': ['creating and commenting the Jira tickets — done by the Brain, installed on a Jira site;',
    'créer et commenter les tickets Jira — fait par le Cerveau, installé sur un site Jira ;'],
  'honesty.not2': ['the pull-request card and the pairing — done by the Sensor, on Bitbucket;',
    'la carte de pull request et l’appairage — faits par le Capteur, sur Bitbucket ;'],
  'honesty.not3': ['the Rovo agent and the MCP tools — live in the Jira tenant.',
    'l’agent Rovo et les outils MCP — vivent dans le tenant Jira.'],

  'footer.license': ['MIT licence.', 'Licence MIT.'],
  'footer.contest': ['Built for the Atlassian Codegeist 2026 hackathon.',
    'Construit pour le hackathon Atlassian Codegeist 2026.'],
  'footer.source': ['Every number on this page is computed from the public source.',
    'Chaque chiffre de cette page est calculé depuis le code source public.'],
};

/** Traduit une clé du site ; retombe sur la table partagée du produit. */
export function t(key: string, lang: Lang): string {
  const entry = TABLE[key];
  if (entry) return lang === 'fr' ? entry[1] : entry[0];
  return sharedT(key, lang);
}

/** Remplace `{nom}` dans un texte par les valeurs fournies. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** Toutes les clés du site (contrôle de couverture des deux langues). */
export function siteKeys(): string[] {
  return Object.keys(TABLE);
}
