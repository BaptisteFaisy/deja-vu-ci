> **Copie fidèle du cahier des charges d'origine — version 1 du 11 novembre 2026.**
> Ce document est reproduit tel quel, sans modification, pour la soumission
> Codegeist 2026. Le reste du dépôt (code, documentation, commentaires) est en anglais.

# Échecs de CI avec mémoire (« Déjà-vu ») — cahier des charges

> Codegeist 2026 · catégorie **Apps for Software Teams**
> Bonus visés : Agents Rovo, MCP, Marketplace (Teamwork Graph en option)
> Version 1 du 11 novembre 2026 · soumission avant le mardi 22 décembre 2026, 21 h (Paris)

## 1. L'idée en une phrase

À chaque build rouge, l'app reconnaît l'erreur, dit en quelques secondes si elle est nouvelle, connue, instable ou due à l'infrastructure, rappelle le correctif qui l'avait résolue et son auteur, et tient un seul ticket par problème au lieu d'un par occurrence.

## 2. Le problème

Un build rouge déclenche toujours la même enquête :

- Est-ce ma modification, ou était-ce déjà cassé ?
- A-t-on déjà vu cette erreur ? Qui l'avait corrigée, et comment ?
- Est-ce ce test instable que tout le monde relance ?
- Est-ce le registre de paquets qui ne répond pas ?

L'information existe, dans des centaines de journaux de pipelines que personne ne relit. Chaque développeur refait donc l'enquête seul. Les tests instables coûtent le plus : on relance, ça passe, personne n'ouvre de ticket, ou dix personnes en ouvrent un chacune.

Les agents de code aggravent le phénomène. Face à un test instable, un agent modifie du code sain pour « réparer » un échec qui n'est pas le sien.

## 3. Utilisateurs

| Qui | Moment | Attente |
|---|---|---|
| Développeur | Son build vient d'échouer | Savoir en 10 secondes si c'est sa faute et quoi faire |
| Relecteur | Une PR arrive avec un build rouge | Savoir s'il peut l'ignorer |
| Responsable qualité, équipe plateforme | Chaque semaine | Quels échecs coûtent le plus, lesquels sont instables |
| Agent de code | Son build échoue | Relancer ou corriger ? Par un outil, sans deviner |
| Astreinte CI | Dix dépôts échouent en même temps | Un seul incident, pas dix alertes |

## 4. Vocabulaire du produit

- **Occurrence** : un échec d'une étape de pipeline, à un commit donné.
- **Signature** : l'empreinte d'une erreur une fois retirés les détails variables (horodatages, numéros de ligne, adresses). Deux occurrences de même signature sont « la même erreur ».
- **Famille** : une signature plus lâche (type et message, sans la pile d'appels), pour rapprocher des variantes.
- **Statut d'une signature** : nouvelle, connue, instable, résolue, régression.
- **Résolution** : le commit qui a fait disparaître une signature, son auteur et, si possible, une explication.
- **Diagnostic** : la réponse donnée au développeur pour une occurrence.

## 5. Les quatre diagnostics

Toute occurrence reçoit un diagnostic parmi quatre, avec un niveau de confiance et les faits qui le justifient.

| Diagnostic | Ce que voit le développeur | Action proposée |
|---|---|---|
| **Instable connu** | « Ce test échoue de façon aléatoire : vu 17 fois sur 9 branches, ticket PAY-88. Sans rapport probable avec ta PR. » | Relancer |
| **Déjà vu, déjà corrigé** | « Même erreur le 3 novembre sur `main`, corrigée par Marie dans `abc123` (mise à jour du client HTTP). Ta branche date d'avant ce correctif. » | Rebaser ou reprendre le correctif |
| **Nouveau** | « Première apparition. L'étape passait au commit précédent. Fichiers modifiés en cause probable : `refund/Limiter.java`. » | Corriger |
| **Infrastructure** | « Registre de paquets injoignable. 6 autres dépôts échouent de la même façon depuis 10 minutes. » | Attendre, relancer |

## 6. Périmètre

Priorités : **M** = indispensable pour la soumission, **S** = souhaitable, **C** = après le hackathon.

| Lot | Contenu |
|---|---|
| MVP (22 décembre) | Capture des échecs Bitbucket Pipelines, signatures, les quatre diagnostics, détection des tests instables, un ticket Jira par problème, carte dans la PR, page « Mémoire de CI », agent Rovo, outils MCP, jeu d'exemple rejouable |
| V1 | Résolutions déduites puis confirmées, détection de régression, coût en minutes de CI, épidémies d'infrastructure, entrée universelle pour d'autres CI |
| Vision | Mise en quarantaine proposée, prévision avant la fin du build, normaliseurs appris par écosystème |

Hors périmètre : relancer un pipeline, modifier le dépôt, juger la qualité des tests.

## 7. La contrainte d'architecture

Une app Forge ne peut pas appeler à la fois Bitbucket et Jira : d'après un fil de la communauté d'avril 2024, les deux familles de scopes ne se combinent pas, et la page actuelle de compatibilité multi-apps ne cite que Jira et Confluence. Ce point est à reconfirmer la première semaine (§ 17).

Le produit est donc fait de deux apps jumelées par un web trigger signé :

| | Capteur (Bitbucket) | Cerveau (Jira) |
|---|---|---|
| Rôle | Voir le build rouge, lire journaux et rapports de tests, extraire les blocs d'erreur | Calculer les signatures, mémoriser, diagnostiquer, tenir les tickets |
| Modules | Déclencheurs d'événements, carte de PR, page de réglages | Web trigger, SQL, LLM, page projet, encart ticket, agent Rovo, actions, MCP |
| Données | Aucune donnée durable | Toute la mémoire |

La mémoire est côté Jira pour trois raisons : c'est là que vivent les tickets, Rovo et le serveur MCP.

## 8. Parcours détaillés

### 8.1 Un build échoue sur une PR

1. Bitbucket émet un événement de statut de build, état « échec ».
2. Le Capteur retrouve le pipeline, liste ses étapes, lit la fin du journal de l'étape en échec et, s'ils existent, les cas de test échoués avec leur raison.
3. Il masque les secrets, garde les blocs d'erreur (50 Ko au plus) et les envoie au Cerveau.
4. Le Cerveau calcule la signature, enregistre l'occurrence, établit le diagnostic.
5. La carte de la PR affiche le diagnostic. Le ticket Jira lié à la branche l'affiche aussi.

### 8.2 Un test devient officiellement instable

Troisième occurrence de la même signature sur une troisième branche en dix jours, dont une suivie d'un succès au même commit. La signature passe à « instable ». L'app crée un ticket unique, étiqueté `test-instable`, avec le nom du test, le tableau des occurrences et le coût. Les occurrences suivantes mettent ce ticket à jour, sans en créer d'autre.

### 8.3 Une erreur disparaît

Sur `main`, l'étape échouait avec la signature S-204 ; elle passe au commit `abc123`. L'app enregistre une résolution candidate : ce commit, son auteur, les fichiers touchés. La page « Mémoire de CI » demande : « Est-ce bien ce correctif ? ». Une confirmation suffit pour qu'il soit cité aux prochains qui croiseront S-204.

### 8.4 Une régression

S-204, résolue depuis trois semaines, réapparaît sur `main`. Le statut passe à « régression », le ticket d'origine est rouvert, l'auteur du correctif est mentionné.

### 8.5 Un agent de code

Le build de l'agent échoue. Il appelle `explain-build-failure`. Réponse : instable connu, relancer. L'agent relance au lieu de modifier le code.

## 9. Calcul de la signature

C'est le cœur du produit. La méthode est déterministe ; le modèle de langage n'intervient qu'en secours.

### 9.1 Extraire

Par ordre de préférence :

1. **Rapports de tests** de l'étape : nom complet du test, message, pile d'appels.
2. **Journal** de l'étape : repérage des blocs d'erreur par motifs connus (JUnit, pytest, Jest, Go, Cargo, npm, Gradle, Maven, TypeScript, ESLint, Docker, mémoire insuffisante, délai dépassé, erreurs réseau).
3. À défaut : les 80 dernières lignes non vides.

### 9.2 Normaliser

Retirer ou remplacer par un jeton neutre :

- horodatages, durées, dates ;
- adresses mémoire, identifiants hexadécimaux, UUID, empreintes de commit ;
- chemins temporaires, noms de conteneurs, ports ;
- numéros de ligne (on garde fichier et fonction) ;
- nombres isolés ; codes de couleur du terminal.

La pile d'appels est réduite aux cinq premières lignes appartenant au projet.

### 9.3 Signer

- **Signature** = empreinte de : catégorie + type d'erreur + message normalisé + pile réduite.
- **Famille** = empreinte de : catégorie + type d'erreur + message normalisé.

### 9.4 Catégoriser

| Catégorie | Indices |
|---|---|
| Test | Issu d'un rapport de tests ou d'un motif de test |
| Compilation | Erreur du compilateur ou du vérificateur de types |
| Style | Outil de lint ou de formatage |
| Dépendance | Résolution ou téléchargement de paquet |
| Infrastructure | Réseau, disque plein, mémoire, image introuvable, quota |
| Délai | Étape interrompue pour durée dépassée |
| Configuration | Variable manquante, fichier de pipeline invalide |
| Inconnue | Rien de reconnu |

### 9.5 Secours par modèle de langage

Quand aucun motif ne reconnaît le bloc, le modèle reçoit le texte et renvoie un gabarit d'erreur canonique et une catégorie. Le résultat est mis en cache par texte normalisé : une même erreur brute n'est jamais soumise deux fois.

## 10. Règles de diagnostic

### 10.1 Instable

Une signature de catégorie Test devient instable si, sur 14 jours glissants :

- elle compte au moins 3 occurrences sur au moins 2 branches distinctes ;
- et au moins une fois, la même étape a réussi au même commit après avoir échoué.

Un indice de 0 à 1 est tenu par test : part des échecs sans modification pertinente. Il sert au classement, pas au diagnostic.

### 10.2 Déjà vu, déjà corrigé

La signature a une résolution confirmée ou candidate, et la branche courante ne contient pas le commit de résolution (comparaison d'ancêtres faite par le Capteur).

### 10.3 Infrastructure

Catégorie Infrastructure ou Dépendance, ou même signature observée sur au moins 3 dépôts en 15 minutes (épidémie).

### 10.4 Nouveau

Aucune occurrence antérieure de la signature ni de sa famille. L'app ajoute les fichiers modifiés par la PR qui figurent dans la pile d'appels.

### 10.5 Résolution candidate

Quand une signature cesse sur une branche : les commits entre le dernier échec et le premier succès sont candidats. Priorité à ceux qui touchent un fichier de la pile ou citent le ticket lié. Confiance faible tant qu'un humain n'a pas confirmé.

## 11. Un seul ticket par problème

- Clé d'unicité : la famille de la signature.
- Création : au passage à « instable », ou à la demande pour toute signature.
- Contenu : nom du test ou de l'erreur, extrait normalisé, tableau des occurrences (date, dépôt, branche, lien), coût, propriétaire suggéré.
- Mise à jour : les nouvelles occurrences modifient une propriété du ticket et un commentaire de synthèse **quotidien**, jamais un commentaire par occurrence.
- Clôture suggérée après 14 jours sans occurrence.
- Réouverture automatique en cas de régression.

## 12. Exigences fonctionnelles

| N° | Exigence | Priorité |
|---|---|---|
| CI-01 | Capter tout statut de build en échec de l'espace de travail jumelé | M |
| CI-02 | Lire la fin du journal de l'étape en échec et les cas de test échoués | M |
| CI-03 | Masquer les secrets avant tout envoi hors de Bitbucket | M |
| CI-04 | Calculer signature, famille et catégorie selon le § 9 | M |
| CI-05 | Rendre l'un des quatre diagnostics, avec confiance et justification, en moins de 30 s après l'échec | M |
| CI-06 | Détecter les tests instables selon le § 10.1 | M |
| CI-07 | Tenir un ticket unique par problème selon le § 11 | M |
| CI-08 | Afficher le diagnostic dans la PR et sur le ticket Jira de la branche | M |
| CI-09 | Page « Mémoire de CI » : signatures, statuts, occurrences, recherche | M |
| CI-10 | Agent Rovo et outils MCP du § 13 | M |
| CI-11 | Jeu d'exemple rejouable sans Bitbucket | M |
| CI-12 | Déduire puis faire confirmer les résolutions | S |
| CI-13 | Détecter les régressions, rouvrir le ticket, mentionner l'auteur du correctif | S |
| CI-14 | Chiffrer le coût : builds rouges, minutes de CI perdues, personnes touchées | S |
| CI-15 | Détecter les épidémies d'infrastructure et ouvrir un seul incident | S |
| CI-16 | Entrée universelle : recevoir un extrait de journal depuis n'importe quelle CI | S |
| CI-17 | Fusionner ou scinder des signatures à la main | S |
| CI-18 | Durée de conservation réglable des extraits bruts | M |
| CI-19 | Proposer la mise en quarantaine d'un test | C |

## 13. Agent Rovo et outils MCP (côté Jira)

### Agent « Déjà-vu CI »

- « Pourquoi le build de PAY-123 est-il rouge ? »
- « A-t-on déjà vu cette erreur ? » (avec un extrait collé)
- « Quels sont nos tests les plus instables ? »
- « Qui a corrigé l'erreur de connexion à la base la dernière fois ? »

### Actions, aussi exposées par `rovo:mcp`

| Clé | Verbe | Entrées | Retour |
|---|---|---|---|
| `explain-build-failure` | GET | `issueKey` ou `buildUrl` | Diagnostic, confiance, justification, action proposée |
| `search-failures` | GET | `text`, `repository` (optionnel) | Signatures proches d'un extrait d'erreur |
| `get-signature` | GET | `signatureId` | Historique, statut, résolution, ticket |
| `list-flaky-tests` | GET | `repository`, `days` | Tests instables classés par coût |
| `report-resolution` | CREATE | `signatureId`, `commit`, `note` | Résolution enregistrée |
| `confirm-resolution` | UPDATE | `signatureId`, `confirmed` | Résolution confirmée ou rejetée |

`search-failures` accepte un texte libre : un agent ou un humain peut coller une erreur vue ailleurs que dans Bitbucket Pipelines.

## 14. Écrans

**Côté Bitbucket (Capteur)**

1. **Carte de PR** : diagnostic du dernier build rouge, justification, lien vers le ticket du problème.
2. **Page de réglages de l'espace de travail** : jumelage, dépôts suivis, taille maximale des extraits.

**Côté Jira (Cerveau)**

3. **Page projet « Mémoire de CI »** : tableau des signatures (statut, catégorie, occurrences, dernière vue, ticket), filtres, recherche par texte ; onglets Tests instables, Résolutions à confirmer, Coût.
4. **Encart sur le ticket** : pour un ticket de développement, le diagnostic du dernier build de sa branche ; pour un ticket de problème, le tableau des occurrences.
5. **Réglages** : projet où créer les tickets, seuils d'instabilité, conservation, clé de l'entrée universelle.

## 15. Architecture

```yaml
# Capteur — app Bitbucket (esquisse, à valider avec forge lint)
modules:
  trigger:
    - key: on-build-status
      function: onBuildStatus
      events:
        - avi:bitbucket:created:build-status
        - avi:bitbucket:updated:build-status
  # carte de PR et page de réglages : clés à relever dans la référence des modules
permissions:
  scopes: [read:repository:bitbucket, read:pipeline:bitbucket, read:pullrequest:bitbucket, storage:app]
  external:
    fetch:
      backend: ['*.webtrigger.atlassian.app']
```

```yaml
# Cerveau — app Jira
modules:
  webtrigger:        # /ingest (occurrences), /query (carte de PR), /universal (autres CI)
  consumer:          # signature, diagnostic, mise à jour des tickets
  scheduledTrigger:  # synthèse quotidienne, clôtures suggérées, purge
  sql:
  llm:
  jira:projectPage:
  jira:issueContext:
  jira:projectSettingsPage:
  rovo:agent:
  action:
  rovo:mcp:
```

### Flux

1. L'événement de statut de build arrive au Capteur. Seul l'état d'échec est traité ; les succès ne servent qu'à noter « a réussi au même commit ».
2. Le Capteur retrouve le pipeline à partir de l'adresse contenue dans le statut, liste les étapes, lit la fin du journal par requête partielle, puis les rapports de tests.
3. Il masque les secrets et envoie au Cerveau : dépôt, branche, commit, auteur, PR, étape, durée, blocs d'erreur.
4. Le web trigger du Cerveau vérifie la signature de la requête, range le message dans une file et répond aussitôt.
5. Le consommateur calcule signature et diagnostic, enregistre, met à jour le ticket du problème.
6. La carte de PR interroge le Cerveau à l'affichage.

Le pont est signé comme suit : empreinte HMAC-SHA256 du corps, horodatage, numéro unique, secret partagé établi au jumelage et rangé dans le stockage de secrets de Forge.

### Entrée universelle

Un web trigger distinct accepte, avec une clé propre au projet, un extrait de journal envoyé par une commande d'une ligne en fin de pipeline. Il rend l'app utilisable avec GitHub Actions, GitLab CI ou Jenkins, et permet aux juges de tester sans Bitbucket.

## 16. Modèle de données (Forge SQL, côté Jira)

| Table | Colonnes principales |
|---|---|
| `signature` | id, family_id, category, error_type, template, frames, status, first_seen, last_seen, occurrences, issue_key |
| `occurrence` | id, signature_id, workspace, repo, branch, commit, author, pr_id, step_name, duration_s, build_url, occurred_at, passed_on_retry |
| `test_stats` | repo, test_name, runs_failed, runs_passed_same_commit, branches, flaky_index, updated_at |
| `resolution` | id, signature_id, commit, author, files_json, note, confidence, confirmed_by, confirmed_at |
| `raw_excerpt` | occurrence_id, text, expires_at |
| `llm_template_cache` | normalized_hash, template, category |
| `outbreak` | id, family_id, started_at, repos_json, incident_key |
| `pairing`, `settings` | liaison avec Bitbucket, réglages du projet |

Un index sur `signature.family_id` et sur `occurrence(signature_id, occurred_at)` suffit aux requêtes d'écran, qui doivent tenir dans les 5 s accordées à un SELECT.

## 17. Contraintes vérifiées et points à valider

### Vérifié dans la documentation (10 et 11 novembre 2026)

- Événements `avi:bitbucket:created:build-status` et `avi:bitbucket:updated:build-status`, scope `read:repository:bitbucket`. La charge utile contient la clé du statut, l'empreinte du commit, l'état, l'adresse du build et la branche.
- Aucun événement Forge propre aux pipelines n'est documenté ; seuls existent les statuts de build et les événements de déploiement.
- L'API Pipelines propose le journal d'une étape (avec requêtes partielles pour les gros fichiers), les rapports de tests, les cas de test et la raison d'échec d'un cas. Scope Forge : `read:pipeline:bitbucket`.
- Fonctions asynchrones : jusqu'à 900 s. Web trigger : 55 s. Charge utile : 5 Mo.
- Forge SQL : 1 Gio par installation en production, 5 s par SELECT, pas de clés étrangères.
- Forge LLMs : 100 requêtes par minute par installation.
- Une app Forge ne peut pas appeler à la fois Jira et Bitbucket.
- Le site de démonstration fourni ne mentionne pas Bitbucket.

### À valider par un prototype la première semaine

| Point | Pourquoi | Solution de repli |
|---|---|---|
| Retrouver le pipeline et ses étapes à partir d'un statut de build | Sans cela, pas de journal | Lister les pipelines récents du commit |
| Lecture du journal d'une étape depuis Forge | Un fil ancien de la communauté signale un dysfonctionnement | Rapports de tests seuls ; entrée universelle |
| Présence de rapports de tests | Ils n'existent que si le pipeline produit des fichiers de résultats | Analyse du journal |
| Événement émis quand une étape est relancée au même commit | Fonde la détection des tests instables | Comparer les statuts successifs d'un même commit |
| Scope supplémentaire pour lire les tests | Une page cite un scope dédié aux tests | L'ajouter au manifeste |
| Appel d'un web trigger depuis l'app Bitbucket | C'est le pont | Entrée universelle appelée depuis le pipeline |

## 18. Exigences non fonctionnelles

- **Rapidité.** Diagnostic disponible moins de 30 s après l'échec, hors délai de livraison de l'événement.
- **Justesse.** Sur un jeu de 100 échecs étiquetés à la main : au moins 90 % de regroupements corrects, et moins de 5 % de faux « instable ».
- **Discrétion.** Un seul commentaire de synthèse par jour et par ticket de problème ; aucun commentaire automatique dans les PR par défaut.
- **Secrets.** Masquage par motifs avant l'envoi (jetons, clés, mots de passe, adresses de messagerie). Seuls les blocs d'erreur quittent Bitbucket, jamais le journal entier.
- **Conservation.** Extraits bruts gardés 30 jours par défaut (réglable) ; signatures et statistiques sans limite.
- **Prudence.** Un diagnostic « sans rapport avec ta PR » n'est rendu qu'au-dessus d'un seuil de confiance ; en dessous, l'app dit « incertain » et montre les faits.
- **Langues.** Interface en anglais et en français ; soumission en anglais.

## 19. Cas limites

- Journal de plusieurs dizaines de mégaoctets : seule la fin est lue.
- Plusieurs étapes en échec dans un pipeline : une occurrence par étape, diagnostic du pire en tête.
- Plusieurs erreurs dans une étape : les trois premières signatures distinctes sont retenues.
- Étape arrêtée à la main : ignorée.
- Erreur dont le message contient une donnée variable non reconnue : deux signatures naissent ; la fusion manuelle corrige et enrichit les règles de normalisation.
- Test renommé : nouvelle signature ; rapprochement proposé si le message et la pile sont identiques.
- Test réellement cassé sur `main` : beaucoup d'occurrences, mais aucun succès au même commit ; il n'est pas déclaré instable.
- Dépôt sans lien avec un projet Jira : occurrences enregistrées, tickets créés dans le projet par défaut.
- Build d'une autre CI sans journal accessible : occurrence enregistrée avec la seule clé du statut, diagnostic « incertain ».

## 20. Recette

1. Deux échecs dont seuls l'horodatage et un numéro de ligne diffèrent reçoivent la même signature.
2. Un échec suivi d'un succès au même commit, répété sur trois branches, fait passer la signature à « instable » et crée un ticket, un seul.
3. Une dixième occurrence met à jour ce ticket sans en créer un autre ni ajouter plus d'un commentaire par jour.
4. Une erreur jamais vue reçoit le diagnostic « nouveau » et cite les fichiers modifiés présents dans la pile.
5. Une erreur de téléchargement de paquet reçoit le diagnostic « infrastructure ».
6. Une signature résolue qui réapparaît passe à « régression » et rouvre son ticket.
7. Un extrait contenant un jeton d'accès arrive masqué côté Jira.
8. `explain-build-failure` renvoie le même diagnostic que la carte de la PR.
9. Le jeu d'exemple, rejoué sur un site sans Bitbucket, produit les quatre diagnostics.

## 21. Scénario de la vidéo (moins de 5 minutes, en anglais)

| Temps | Contenu |
|---|---|
| 0:00 – 0:30 | Un build rouge, trois personnes qui posent la même question dans le chat d'équipe |
| 0:30 – 1:20 | Cas 1 : test instable reconnu, carte dans la PR, ticket unique avec 17 occurrences |
| 1:20 – 2:10 | Cas 2 : erreur déjà corrigée, le commit et l'auteur du correctif sont cités |
| 2:10 – 2:50 | Cas 3 : erreur nouvelle, fichiers en cause |
| 2:50 – 3:20 | Cas 4 : six dépôts échouent ensemble, un seul incident |
| 3:20 – 4:00 | Page « Mémoire de CI » : coût des tests instables sur 30 jours |
| 4:00 – 4:35 | Un agent de code appelle `explain-build-failure` et relance au lieu de modifier le code |
| 4:35 – 4:50 | Architecture : capteur, pont signé, mémoire, Rovo, MCP |

Dépôt de démonstration à préparer : un test volontairement aléatoire, une régression réelle, une dépendance pointant vers un registre coupé.

## 22. Comment les juges testeront

1. **Sans Bitbucket.** Installer l'app Jira, cliquer « Rejouer le jeu d'exemple » : 40 échecs répartis sur 14 jours sont injectés et produisent signatures, diagnostics et tickets. Agent Rovo et outils MCP sont utilisables aussitôt. Une commande d'une ligne permet d'envoyer son propre extrait.
2. **Avec Bitbucket.** Installer l'app Bitbucket, jumeler, pousser un commit sur le dépôt d'exemple fourni.

## 23. Plan jusqu'au 22 décembre

| Semaine | Objectif |
|---|---|
| 11 – 17 nov. | Les six validations du § 17 ; un échec réel qui arrive jusqu'à la base Jira |
| 18 – 24 nov. | Extraction, normalisation, signatures, jeu de 100 échecs étiquetés |
| 25 nov. – 1er déc. | Diagnostics, détection des tests instables, ticket unique |
| 2 – 8 déc. | Page « Mémoire de CI », carte de PR, encart ticket |
| 9 – 15 déc. | Agent, MCP, jeu d'exemple, entrée universelle ; gel des fonctionnalités le 15 |
| 16 – 22 déc. | Recette, vidéo, instructions pour les juges, soumission, dépôt Marketplace |

## 24. Risques

| Risque | Parade |
|---|---|
| Journaux inaccessibles depuis Forge | Rapports de tests ; entrée universelle depuis le pipeline |
| Signatures trop fines ou trop larges | Jeu étiqueté, deux niveaux (signature et famille), fusion manuelle |
| Faux « ce n'est pas ta faute » | Seuil de confiance, diagnostic « incertain », faits toujours montrés |
| Secrets dans les journaux | Masquage avant envoi, extraits bornés, conservation courte |
| Juges sans Bitbucket | Jeu d'exemple et entrée universelle |
| Deux apps à installer | Jumelage en trois étapes, app Jira utile seule |

## 25. La vision poussée à l'extrême

- **Prévoir avant la fin du build.** Dès qu'une étape affiche une ligne connue, le diagnostic tombe sans attendre l'échec complet.
- **Quarantaine proposée.** Pour un test instable coûteux, l'app rédige la modification qui l'isole et le ticket qui engage à le réparer.
- **Coût rendu visible.** « Les tests instables ont coûté 61 heures de CI et 212 relances ce mois-ci » : un chiffre qui fait arbitrer.
- **Mémoire entre organisations.** Les erreurs d'outils publics (registres, images de base) reconnues partout, sans partager une ligne de code.
- **Les agents cessent de tourner en rond.** Tout agent de code interroge la mémoire avant de toucher au code après un build rouge.
- **Lien avec la dette.** Les signatures récurrentes d'un composant alimentent le chiffrage de sa dette technique.

## 26. Sources

- [Codegeist 2026](https://codegeist2026.devpost.com/), son [règlement](https://codegeist2026.devpost.com/rules) et ses [ressources](https://codegeist2026.devpost.com/resources)
- [Événements Bitbucket dans Forge](https://developer.atlassian.com/platform/forge/events-reference/bitbucket/)
- [API Pipelines de Bitbucket Cloud](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/)
- [Rapports de tests dans Pipelines](https://support.atlassian.com/bitbucket-cloud/docs/test-reporting-in-pipelines/)
- [Fil sur la lecture des journaux d'étape](https://community.developer.atlassian.com/t/api-endpoint-for-fetching-bitbucket-pipeline-step-logs-doesnt-fetch-build-step-logs-anymore/90290)
- [Scopes Jira et Bitbucket dans une même app (fil de la communauté)](https://community.developer.atlassian.com/t/access-jira-and-bitbucket-scopes-in-the-same-forge-app/79065)
- [Web trigger](https://developer.atlassian.com/platform/forge/manifest-reference/modules/web-trigger/)
- [Module Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/) et [module Action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)
- [Limites d'invocation](https://developer.atlassian.com/platform/forge/limits-invocation/), [limites SQL](https://developer.atlassian.com/platform/forge/limits-sql/), [limites LLM](https://developer.atlassian.com/platform/forge/limits-llm/)
