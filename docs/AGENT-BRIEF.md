# AGENT-BRIEF — règles communes aux sous-agents

Tu travailles sur le dépôt **BaptisteFaisy/deja-vu-ci** (Déjà-vu CI, Codegeist 2026, apps Forge).
Lis d'abord, dans cet ordre : `docs/CONTRACTS.md` puis `packages/core/src/types.ts`.
Tu n'as pas la mémoire de `b` : tout ce dont tu as besoin est dans ces deux fichiers.

## 1. Atelier (worktree jetable)

```bash
cd /home/baptiste/tmp/deja-vu-ci && git fetch -q origin main
git worktree add /home/baptiste/tmp/dv-<lot> -b feat/<lot> origin/main
cd /home/baptiste/tmp/dv-<lot>
ln -s /home/baptiste/tmp/deja-vu-ci/node_modules node_modules   # dépendances déjà installées
```

Ne travaille **jamais** dans `/home/baptiste/tmp/deja-vu-ci` (arbre partagé) : worktree obligatoire.

## 2. Règles de code (non négociables)

- TypeScript strict, ESM, `module: NodeNext` → **imports relatifs avec `.js`** :
  `import { maskSecrets } from './mask.js';`
- Zéro dépendance runtime hors `node:*` (dans `packages/*`). Les tests n'utilisent que `vitest`.
- **Fichier < 500 lignes, fonction < 50 lignes.** Zéro duplication : un helper existe une fois.
- Aucun test ne touche le réseau ni le disque hors `os.tmpdir()`.
- Tu ne touches **que** tes fichiers (table de propriété du `CONTRACTS.md`). Si tu crois devoir
  modifier un fichier gelé, tu t'arrêtes et tu le dis dans ton rapport.
- Les commentaires de code sont en anglais ; les messages utilisateur (diagnostics) en anglais.
- Pas de `console.log` dans `packages/core/src` (les outils impriment, le moteur non).

## 3. Vérifier avant de pousser

```bash
npx tsc -p packages/core --noEmit && npx tsc -p packages/bridge --noEmit
npx vitest run --reporter=dot          # tout doit être vert, pas seulement tes tests
wc -l <tes fichiers>                    # < 500
```

Une PR dont la CI est rouge ne rentre pas dans la file : elle est refusée, pas réparée par un humain.

## 4. PR : périmètre déclaré obligatoire

La garde `couche0` exige que **chaque fichier modifié** figure en puce dans la section `## Scope`
du corps de la PR, et interdit des motifs dans les lignes ajoutées.

```bash
git add -A && git commit -q -m "<type>(<lot>): <résumé>"
git push -q -u origin feat/<lot>
FICHIERS=$(git diff --name-only origin/main | sed 's/^/- `/' | sed 's/$/`/')
gh pr create --base main --head feat/<lot> --title "<type>(<lot>): <résumé>" --body "$(cat <<EOF
## Scope
$FICHIERS

## Quoi
<3 à 6 lignes : ce qui est implémenté, ce qui est testé, les limites connues>
EOF
)"
```

La garde refuse aussi certains motifs **écrits dans les fichiers** : une prise de côté forcée à la
résolution de conflit, un push forcé sans lease, un déclencheur à privilèges, une clé d'API ou un
jeton en clair, et une date antérieure au 26/10/2026. **N'écris jamais ces motifs dans un fichier
du dépôt, même pour les décrire** : écris en toutes lettres « prise de côté forcée », « push forcé
avec lease », « jeton en clair ». Ne mets **jamais** de secret, de jeton ou de clé dans le dépôt.

## 5. Barre de sortie

Après **3 essais ratés** sur le même point : tu laisses en l'état, tu écris `KO` et la raison
exacte dans ton rapport. Tu ne réessaies pas indéfiniment, tu ne désactives pas un test pour
faire passer la CI.

Ton rapport final contient : ce qui est livré, le nombre de tests verts, les tailles de fichiers,
l'URL de la PR, et les points ouverts.
