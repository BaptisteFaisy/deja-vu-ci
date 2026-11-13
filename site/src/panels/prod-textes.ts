/**
 * Les textes du panneau « Production » — anglais et français.
 *
 * Enregistrés au chargement du module (chaque panneau possède ses clés, voir
 * `lib/i18n.ts`). Le vocabulaire du **produit** (un diagnostic, un statut, une
 * date) n'est pas ici : il vient de `@dejavu/present`, comme partout ailleurs.
 */

import { registerStrings } from '../lib/i18n';

registerStrings({
  'panel.prod.title': ['Production', 'Production'],
  'panel.prod.summary': [
    'The app installed on a real Jira site: what was recorded there, next to what this page computes.',
    'L’app installée sur un vrai site Jira : ce qui y a été relevé, face à ce que cette page calcule.',
  ],

  'prod.split.title': ['One product, two places', 'Un produit, deux endroits'],
  'prod.split.note': [
    'Two columns, two truths. Here, the engine runs in your browser from the committed `site/public` bundle; there, the installed app runs on the real Jira site. The two are never mixed up.',
    'Deux colonnes, deux vérités. Ici, le moteur tourne dans votre navigateur depuis le bundle commité de `site/public` ; là, l’app installée tourne sur le vrai site Jira. Les deux ne sont jamais mélangés.',
  ],
  'prod.here.title': ['Runs here — in your browser', 'Tourne ici — dans votre navigateur'],
  'prod.here.1': [
    'the real engine (`packages/core`), bundled for the web, unmodified;',
    'le vrai moteur (`packages/core`), bundlé pour le web, non modifié ;',
  ],
  'prod.here.2': [
    'the sample set tracked by git (40 failures, 14 days, 3 repositories);',
    'le jeu d’exemple suivi par git (40 échecs, 14 jours, 3 dépôts) ;',
  ],
  'prod.here.3': [
    'a memory local to this page, a ticket plan, zero network;',
    'une mémoire locale à cette page, un plan de tickets, zéro réseau ;',
  ],
  'prod.here.4': [
    'the figures below, computed live — a replay, not a screenshot.',
    'les chiffres ci-dessous, calculés en direct — un rejeu, pas une capture.',
  ],
  'prod.there.title': ['Runs in the deployed app', 'Tourne dans l’app déployée'],
  'prod.there.1': [
    'the real Jira site (project PAY) and the real Forge SQL memory;',
    'le vrai site Jira (projet PAY) et la vraie mémoire Forge SQL ;',
  ],
  'prod.there.2': [
    'the real Jira tickets — created, commented, reopened — and the real signed bridge;',
    'les vrais tickets Jira — créés, commentés, rouverts — et le vrai pont signé ;',
  ],
  'prod.there.3': [
    'the figures recorded on {date}, frozen in this page, not recomputed.',
    'les chiffres relevés le {date}, figés dans cette page, non recalculés.',
  ],

  'prod.observed.title': ['What was recorded in production', 'Ce qui a été relevé en production'],
  'prod.observed.note': [
    'Recorded on {date} on the site {site}, from the app page of project PAY. Observed facts, not a replayed measure: the same button and the same sample set, run inside the installed app.',
    'Relevé le {date} sur le site {site}, depuis la page de l’app du projet PAY. Des faits constatés, pas une mesure rejouée : le même bouton et le même jeu d’exemple, exécutés dans l’app installée.',
  ],
  'prod.col.observation': ['Observation', 'Observation'],
  'prod.col.value': ['Recorded value', 'Valeur relevée'],
  'prod.facts.title': ['The installation', 'L’installation'],
  'prod.app.site': ['Jira site', 'Site Jira'],
  'prod.app.id': ['App id', 'Identifiant de l’app'],
  'prod.app.env': ['Environment', 'Environnement'],
  'prod.app.version': ['Deployed version', 'Version déployée'],
  'prod.app.status': ['Installation', 'Installation'],
  'prod.app.page': ['App page', 'Page de l’app'],
  'prod.counts.title': ['The replay, recorded in production', 'Le rejeu, relevé en production'],
  'prod.signatures': ['Signatures', 'Signatures'],
  'prod.failures': ['Failures replayed', 'Échecs rejoués'],
  'prod.comments': ['Comments planned', 'Commentaires planifiés'],
  'prod.live.title': ['The same replay, here and now', 'Le même rejeu, ici et maintenant'],
  'prod.live.note': [
    'Left column: recorded in production on {date}. Right column: computed by this page, in your browser, from the same sample file (identical bytes, tracked by git). Any difference is shown with its gap, not smoothed over.',
    'Colonne de gauche : relevé en production le {date}. Colonne de droite : calculé par cette page, dans votre navigateur, depuis le même fichier d’exemple (octets identiques, suivi par git). Toute différence est affichée avec son écart, pas lissée.',
  ],
  'prod.live.why': [
    'The deployed build now comes from this same tree (v2.13.0). The left column is the recording made in production, the right one is computed here, by the same engine: a difference would be a defect, and it is shown with its gap, never smoothed over.',
    'Le build déployé vient désormais de ce même arbre (v2.13.0). La colonne de gauche est le relevé fait en production, celle de droite est calculée ici, par le même moteur : une différence serait un défaut, et elle est affichée avec son écart, jamais lissée.',
  ],
  'prod.col.recorded': ['Recorded in production', 'Relevé en production'],
  'prod.col.here': ['Computed here', 'Calculé ici'],
  'prod.diagnostics': ['Diagnostics (one per failure)', 'Diagnostics (un par échec)'],
  'prod.diagnostics.note': [
    'The engine’s own words, from `@dejavu/present`. The five counts add up to {total}: one verdict per replayed failure.',
    'Les mots du moteur lui-même, depuis `@dejavu/present`. Les cinq comptes font {total} : un verdict par échec rejoué.',
  ],
  'prod.incident.title': ['The incident, detected for real', 'L’incident, détecté pour de vrai'],
  'prod.incident.note': [
    'CI-15: one infrastructure outage, one family, no invented alerts. The incident below was recorded in the installed app, from the real failure occurrences in the memory.',
    'CI-15 : une panne d’infrastructure, une famille, aucune alerte inventée. L’incident ci-dessous a été relevé dans l’app installée, depuis les vraies occurrences de la mémoire.',
  ],
  'prod.refusal.title': ['The honest refusal', 'Le refus honnête'],
  'prod.refusal.note': [
    'When the app tried to write a ticket, Jira answered HTTP {status} — the target project was not configured. The app displayed the refusal instead of hiding it. That French message is what the operator saw, kept as proof.',
    'Quand l’app a tenté d’écrire un ticket, Jira a répondu HTTP {status} — le projet cible n’était pas configuré. L’app a affiché le refus au lieu de le cacher. Ce message en français est ce que l’opérateur a vu, gardé pour preuve.',
  ],

  'prod.env.title': ['The four real environments', 'Les quatre environnements réels'],
  'prod.env.note': [
    'Each card is one environment that really exists when the site is visited, with its clickable link. Nothing here is a mock.',
    'Chaque fiche est un environnement qui existe vraiment quand le site est visité, avec son lien cliquable. Rien ici n’est une maquette.',
  ],
  'prod.env.jira.title': ['Jira Cloud', 'Jira Cloud'],
  'prod.env.jira.text': ['The installed app: project PAY, its page and its button.', 'L’app installée : projet PAY, sa page et son bouton.'],
  'prod.env.sql.title': ['Forge SQL', 'Forge SQL'],
  'prod.env.sql.text': ['The memory: 15 signatures, their occurrences, read by every screen.', 'La mémoire : 15 signatures, leurs occurrences, lues par tous les écrans.'],
  'prod.env.actions.title': ['GitHub Actions', 'GitHub Actions'],
  'prod.env.actions.text': ['The nightly checks: engine rebuilt, corpus re-measured, suite run.', 'Les vérifications nocturnes : moteur reconstruit, corpus re-mesuré, suite lancée.'],
  'prod.env.pages.title': ['GitHub Pages', 'GitHub Pages'],
  'prod.env.pages.text': ['This site: the committed bundle, served unchanged.', 'Ce site : le bundle commité, servi tel quel.'],
  'prod.env.link': ['Open', 'Ouvrir'],

  'prod.repro.title': ['Reproduce it yourself', 'Reproduire soi-même'],
  'prod.repro.note': [
    'The real steps that produced the figures above — no copy of the docs, they are linked below.',
    'Les vraies étapes qui ont produit les chiffres ci-dessus — pas de copie de la doc, elle est liée ci-dessous.',
  ],
  'prod.repro.s1.title': ['Install the app on a Jira site', 'Installer l’app sur un site Jira'],
  'prod.repro.s1.text': ['`forge install --demo-site --product jira`, as documented in DEPLOY.', '`forge install --demo-site --product jira`, comme documenté dans DEPLOY.'],
  'prod.repro.s2.title': ['Open the project', 'Ouvrir le projet'],
  'prod.repro.s2.text': ['In project PAY, open « Déjà-vu CI » from the project menu.', 'Dans le projet PAY, ouvrez « Déjà-vu CI » depuis le menu du projet.'],
  'prod.repro.s3.title': ['Click « Replay the sample set »', 'Cliquer « Rejouer le jeu d’exemple »'],
  'prod.repro.s3.text': ['The memory fills: 15 signatures, 40 failures, 11 planned comments.', 'La mémoire se remplit : 15 signatures, 40 échecs, 11 commentaires planifiés.'],
  'prod.repro.s4.title': ['Read the figures', 'Lire les chiffres'],
  'prod.repro.s4.text': ['Diagnostics, incident and plan — exactly what this page shows.', 'Diagnostics, incident et plan — exactement ce que montre cette page.'],
  'prod.link.app': ['The app page, in project PAY', 'La page de l’app, dans le projet PAY'],
  'prod.link.deploy': ['docs/DEPLOY.md', 'docs/DEPLOY.md'],
  'prod.link.judges': ["docs/JUDGES.md (judges' guide)", 'docs/JUDGES.md (guide des juges)'],
  'prod.link.console': ['Forge console (environments)', 'Console Forge (environnements)'],
  'prod.link.repo': ['Repository', 'Dépôt'],

  'prod.gaps.title': ['What production does not show yet', 'Ce que la production ne montre pas encore'],
  'prod.gaps.note': [
    'Honesty, end to end: the two edges below are real, and stated rather than papered over.',
    'Honnêteté bout en bout : les deux limites ci-dessous sont réelles, énoncées plutôt que maquillées.',
  ],
  'prod.gaps.pairing.title': ['The signed bridge has no secret set in production', 'Le pont signé n’a pas de secret posé en production'],
  'prod.gaps.pairing.text': [
    '`savePairing` is defined but never called: the Sensor and the Brain are not paired, so no HMAC secret exists in the tenant yet. The bridge is proven by tests and by the browser demo, not yet by a live tenant.',
    '`savePairing` est défini mais jamais appelé : le Capteur et le Cerveau ne sont pas appairés, donc aucun secret HMAC n’existe encore dans le tenant. Le pont est prouvé par les tests et la démo navigateur, pas encore par un tenant en direct.',
  ],
  'prod.gaps.ticket.title': ['Ticket creation waits for the target project', 'La création de ticket attend le projet cible'],
  'prod.gaps.ticket.text': [
    'Jira answered HTTP 400 because the target project was not configured. Once it is, the Brain will create the tickets; until then it says so, loud.',
    'Jira a répondu HTTP 400 parce que le projet cible n’était pas configuré. Une fois qu’il le sera, le Cerveau créera les tickets ; en attendant, il le dit, clairement.',
  ],
});
