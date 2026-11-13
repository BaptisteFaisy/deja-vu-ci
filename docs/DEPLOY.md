# Déploiement des deux apps Forge

Ce document décrit la chaîne réelle, exécutée le 11 novembre 2026 : création des
deux apps sur un compte Atlassian, lint, déploiement, installation sur un site.
Les identifiants ci-dessous sont les apps réellement créées.

## 0. Prérequis

| Élément | Valeur |
|---|---|
| CLI Forge | `~/.atlassian/cli/node_modules/.bin/forge` (14.2.0) — **pas** le `forge` de Foundry (`~/.local/bin/forge`, qui lint du Solidity) |
| Node du CLI | 22.x ou 24.x : `~/.local/node/bin` (22.13.0). Le Node 26 du poste fait tourner le CLI avec un avertissement |
| Identifiants | `FORGE_EMAIL` + `FORGE_API_TOKEN` (jeton dans `~/.atlassian-api-token`, mode 600, jamais affiché ni commité) |
| Developer Space | `laddition` |
| Site de démonstration | `https://one-atlas-cndz.atlassian.net` (Jira + Confluence, actif, expire le 2027-02-09) |

```bash
export PATH="$HOME/.local/node/bin:$HOME/.atlassian/cli/node_modules/.bin:$PATH"
export FORGE_EMAIL="<compte Atlassian>"
export FORGE_API_TOKEN="$(cat ~/.atlassian-api-token)"
```

## 1. Les deux apps créées

| App | Produit | Identifiant (`app.id`) |
|---|---|---|
| **Deja-vu CI Brain** (le Cerveau) | Jira | `ari:cloud:ecosystem::app/2abacda7-8c4f-4b29-9c97-7209dd240894` |
| **Deja-vu CI Sensor** (le Capteur) | Bitbucket | `ari:cloud:ecosystem::app/f4c98609-1c94-4e98-9e26-89cec008d6d7` |

Chaque app a trois environnements : `production`, `staging`, `development`.

Elles ont été créées par `forge create`, qui est **interactif** (Developer Space,
nom, acceptation des conditions, produit, catégorie, modèle) : la commande a été
pilotée dans un pseudo-TTY (`script -qec`) alimenté par un FIFO, avec les
réponses envoyées à la suite. Le modèle choisi ne sert qu'à obtenir
l'identifiant : c'est **notre** `manifest.yml` qui est déployé ensuite.

## 2. Construire le moteur avant de déployer

Les deux apps importent `@dejavu/core` et `@dejavu/bridge` en dépendances
locales (`file:../../packages/…`), dont le `package.json` pointe vers `dist/` :
**sans build, le bundle Forge ne résout rien**.

```bash
npm ci --prefer-offline --no-audit --no-fund && npm run build
```

## 3. Lint, déploiement, installation

Avant de déployer, l'arbre installé de l'app doit contenir **une seule copie
de React** : le bundler Forge construit avec l'arbre local, et deux copies
cassent le rendu (page blanche, `Cannot read properties of null (reading
'useState')`). Le contrôle est dans le dépôt :

```bash
node tools/forge-tree.mjs      # sortie 1 si une app a React en double
```

Si le contrôle échoue, l'arbre est pollué (un `node_modules/node_modules/`
parasite) : le refaire dans l'app avec `npm ci` avant de déployer.

```bash
cd apps/brain
npm install --no-audit --no-fund
forge lint        # doit dire « No issues found »
forge deploy      # environnement development par défaut
forge install --demo-site --product jira --confirm-scopes --non-interactive

cd ../sensor
npm install --no-audit --no-fund
forge lint
forge deploy
forge install --demo-site --product bitbucket --confirm-scopes --non-interactive
```
## 4. Ouvrir le site

```bash
xdg-open https://one-atlas-cndz.atlassian.net
```

Une fois l'app installée :

- **page projet « Mémoire de CI »** — Jira → un projet → *Déjà-vu CI* dans le
  menu du projet ;
- **encart du ticket** — panneau *Déjà-vu CI* sur un ticket (diagnostic du
  dernier build rouge de la branche, ou tableau des occurrences) ;
- **réglages du projet** — paramètres du projet → *Déjà-vu CI* ;
- **agent Rovo** — *Déjà-vu CI* dans la liste des agents, avec les six actions
  du § 13 (les mêmes sont exposées par le serveur MCP *Déjà-vu CI MCP*).

## 5. Six leçons du déploiement réel

1. **`ForgeReconciler.render()` est obligatoire.** Un point d'entrée UI Kit qui
   exporte seulement `default function App()` ne rend rien : il faut
   `ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>)`
   (vérifié dans le modèle officiel `jira-issue-panel` généré le 11/11).
2. **L'icône peut être une URL**, pas forcément une ressource (`icon:
   https://…/issue-panel-icon.svg` dans le modèle officiel). Seul `jira:issuePanel`
   l'exige.
3. **Le schéma du manifeste est strict** : `consumer.retry` interdit,
   `action` exige `description` + `actionVerb`, `sql` exige `engine: mysql`,
   `llm` exige `model: [claude]`, `rovo:mcp` exige `tools` (pas de `cloud` ni
   `description`), les modules UI en variante `resource` exigent
   `resources:` + `resolver` + `render: native`.
4. **`@forge/api` 8.x n'exporte plus `storage`** (retiré en 8.0.0) : les apps qui
   en dépendent épinglent `^7.2.2`, ou passent par `@forge/sql`.
5. **Forge SQL est TiDB** : `LIMIT ?` lié échoue (`ERROR 1210`) — la limite
   s'inline après coercion entière. Nos requêtes n'utilisent pas de `LIMIT`
   lié ; à surveiller si on en ajoute.
6. **Les files `@forge/events` livrent `AsyncEvent { body, jobId, … }`**, pas le
   message nu, et **Forge LLM renvoie `content` en blocs**
   `[{ type: 'text', text }]` : les deux formes sont déjà gérées dans
   `apps/brain/src/consumer.ts` (`chatText`, `message.body`).

## 6. Le Capteur a besoin d'un espace Bitbucket

Le site de démonstration fourni par Forge est **Jira + Confluence** : il ne
contient pas Bitbucket (déjà noté au § 17 du cahier des charges). Le Capteur se
déploie donc, mais ne s'installe que sur un espace Bitbucket Cloud réel.

Sans Bitbucket, le produit reste entièrement démontrable par le Cerveau seul :

- le jeu d'exemple rejouable (`npm run replay`) produit les quatre diagnostics ;
- l'**entrée universelle** (`tools/universal-entry.sh` → web trigger
  `/universal`) alimente le Cerveau depuis n'importe quelle CI, GitHub Actions
  compris — c'est le chemin prévu pour les juges sans Bitbucket (§ 22).
