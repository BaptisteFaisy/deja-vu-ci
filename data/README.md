# data — jeux de données Déjà-vu CI

Deux fichiers, deux usages. Aucun n'exige Bitbucket, Jira ni réseau : tout est
rejoué localement par le moteur (`packages/core`).

| Fichier | Contenu | Commande |
|---|---|---|
| `sample/occurrences.json` | 40 échecs et 8 succès sur 14 jours, dans un dépôt fictif `payments-api` et deux voisins | `npm run replay` |
| `labeled/100-failures.json` | 100 échecs étiquetés à la main, 27 groupes distincts | `npm run eval` |

Les deux sont **générés**, pas écrits à la main : les générateurs vivent dans
`tools/gen/` et les journaux réalistes (JUnit, pytest, Jest, Go, npm, pip,
Maven, Gradle, ESLint, tsc, Docker) dans `tools/lib/logs.mjs`.

```bash
node tools/gen/sample.mjs     # régénère sample/occurrences.json
node tools/gen/corpus.mjs     # régénère labeled/100-failures.json
node tools/check-dataset.mjs  # contrôle de conformité des deux fichiers
```

## Le jeu d'exemple (CI-11)

Il est construit pour produire les quatre diagnostics du § 5 et les trois
mouvements de statut du § 8 :

| Séquence | Ce qu'elle montre |
|---|---|
| 17 échecs du test `RefundLimiterTest#limitsRefundAmount` sur 9 branches, dont 3 succès au même commit | **instable connu** (§ 10.1) : un seul ticket, étiqueté `test-instable`, puis 14 mises à jour sans nouveau commentaire le même jour |
| L'erreur `token descriptor is null` sur `main`, le correctif `abc1234` de Marie, puis la même erreur sur une branche antérieure au correctif | **déjà vu, déjà corrigé** (§ 10.2) : le commit, l'auteur et la note sont cités |
| La même erreur qui revient sur `main`, qui contient le correctif (`containsCommits`) | **régression** (§ 8.4) : statut `regression`, ticket rouvert |
| 8 échecs `ECONNREFUSED` sur 3 dépôts en 12 minutes | **infrastructure** (§ 10.3) : épidémie, un seul incident |
| 12 erreurs jamais vues, dont les fichiers modifiés par la PR apparaissent dans la pile | **nouveau** (§ 10.4) : fichiers suspects cités |

`npm run replay` rejoue le jeu, affiche les signatures, les diagnostics, les
actions de tickets et les quatre compteurs, puis **vérifie la recette** : il
sort en code 1 si un des quatre diagnostics manque, si le nombre de tickets
créés n'est pas 1, ou si une attente du jeu n'est pas tenue.

## Le corpus étiqueté (§ 18)

Chaque échec porte le groupe, la catégorie et le diagnostic attendus. Les
membres d'un groupe ne diffèrent que par un détail volatil — horodatage,
numéro de ligne, UUID ou port — et doivent donc retomber sur la même signature.
Vingt paires explicites exercent cette propriété.

`npm run eval` mesure et compare aux seuils du cahier des charges :

- regroupement correct ≥ 90 % ;
- faux « instable » < 5 % ;
- catégorie correcte ≥ 90 %.

Cinq échecs volontairement ambigus sont documentés sur place (`notes`) : une
connexion refusée, un timeout de rapport de tests, une image introuvable, une
étape qui n'imprime qu'une phrase sans motif connu, un échec de résolution npm
qui ressemble à une coupure réseau.
