# flaky-repo — dépôt de démonstration Déjà-vu CI

Trois échecs volontaires, un par diagnostic du scénario de la vidéo (§ 21) :

| Étape | Ce qui échoue | Diagnostic attendu |
|---|---|---|
| `install-dependencies` | registre de paquets injoignable (`registry-cut.invalid.example`) | **infrastructure** |
| `unit-tests` | `test/flaky.test.js` échoue environ une fois sur trois | **instable connu** (après 3 branches) |
| `integration-tests` | `buildAuthHeader({})` lève une `TypeError` | **nouveau**, puis **déjà corrigé** après le correctif |

## Pousser ce dépôt sur Bitbucket

```bash
cd examples/flaky-repo
git init && git add -A && git commit -m "démonstration Déjà-vu CI"
git remote add origin git@bitbucket.org:<workspace>/flaky-repo.git
git push -u origin main
```

## Provoquer les quatre diagnostics

1. **Instable** : poussez `flaky-repo` sur trois branches et relancez l'étape
   `unit-tests` jusqu'à voir un succès au même commit après un échec.
2. **Déjà corrigé** : corrigez `src/httpClient.js` sur `main`
   (`if (!session?.token) throw …` → rafraîchir le jeton), puis poussez une
   branche créée **avant** ce correctif.
3. **Nouveau** : ajoutez une assertion fausse dans un fichier que la PR modifie.
4. **Infrastructure** : laissez l'étape `install-dependencies` échouer ; le même
   échec sur trois dépôts en moins de 15 minutes déclenche l'épidémie.

## Sans Bitbucket

Le jeu d'exemple rejouable (`data/sample/occurrences.json`) produit les quatre
diagnostics sans aucun compte Atlassian :

```bash
npm ci && npm run replay
```
