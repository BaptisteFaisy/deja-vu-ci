# Pipeline du dépôt — file de merge, gardes et agents

Ce document décrit la chaîne qui fait passer une PR du dépôt à `main`. Il n'y a
**qu'un seul pilote de merge** : la file Mergify. Ni les gardes ni les agents ne
mergent quoi que ce soit.

## 1. Les checks requis

Trois checks sont exigés par le ruleset de `main` et par la file
(`.mergify.yml`) :

| Check | Workflow | Rôle | Durée observée |
|---|---|---|---|
| `ci` | `.github/workflows/ci.yml` | types, tests du moteur/du pont/des apps, sanity docs, tests des gardes | ~40 s |
| `ci-budget` | `.github/workflows/ci-budget.yml` | aucun job de CI au-delà de 5 minutes, `concurrency` et `fetch-depth: 1` présents | ~5 s |
| `couche0` | `.github/workflows/couche0.yml` | périmètre déclaré dans `## Scope` + motifs interdits dans le diff | ~9 s |

`stale-base-guard` est informatif : il signale une branche trop loin de `main`.

### Le budget de 5 minutes

Chaque job déclare `timeout-minutes: 5` au plus. Deux dispositifs tiennent ce
budget sur des runners self-hosted :

- **`node_modules` reste en place** entre les runs (`git clean -ffdx -e
  node_modules`) et n'est réinstallé que si l'empreinte de `package-lock.json`
  change (`node_modules/.ci-lock-hash`) ;
- **les temporaires vont sur le disque** (`TMPDIR=$HOME/.cache/ci-tmp`) : le
  `/tmp` des runners est un tmpfs de 16 Go partagé, vu plein à 100 % — vitest y
  mourait en `ENOSPC` alors que le disque avait 90 Go libres.

Node n'est pas sur le `PATH` par défaut du runner : le job l'ajoute depuis
`$HOME/.local/node/bin`.

## 2. La file de merge

`.mergify.yml` : `merge_method: squash` (une PR = un commit sur `main`) et
`update_method: merge` (mise à jour par fusion de `main`, jamais de réécriture
de la branche de PR). Le rebase de GitHub refusait les PR ayant déjà fusionné
`main` (« GitHub cannot rebase the pull request ») : c'est ce qui a motivé ce
réglage.

Produits activés par API : `merge_queue` et `merge_protections`. Une PR verte
entre en file seule ; le balayeur `pr-auto-merge` poste `@mergifyio queue` en
secours et gère les états que la file ne sait pas traiter.

## 3. Le balayeur (`pr-auto-merge`)

Il se réveille sur `push` vers `main`, à la fin d'un run `CI`, et sur
`pull_request: edited` / `ready_for_review`. Il inventorie les PR ouvertes, les
classe (`CLEAN`, `BEHIND`, `DIRTY`, `BLOCKED`, `DRAFT`) et agit :

- `CLEAN` → embarquement dans la file ;
- `BEHIND` → mise à jour par Mergify ;
- `DIRTY` → rebase tenté, et **en cas de conflit, saisine de l'agent de
  conflit** ;
- `BLOCKED` sur un check rouge → triage puis, si le verdict le permet, saisine
  de l'agent de réparation.

Un backoff de 10 minutes par PR évite de ressaisir un agent sur une tête qui n'a
pas bougé.

## 4. Les agents

| Agent | Fichier | Déclencheur | Ce qu'il fait |
|---|---|---|---|
| Conflit | `.github/fireworks/conflict_agent.py` | PR `DIRTY` après un rebase en conflit | résout chaque conflit élémentaire, garde les deux intentions, pousse sur la branche de la PR |
| Périmètre | `.github/fireworks/scope_agent.py` | `couche0` rouge sur le périmètre | propose un corps de PR avec le `## Scope` manquant |
| Test rouge | `.github/fireworks/test_agent.py` | `ci` rouge + verdict de triage | propose un correctif de code |
| Triage | `tools/triage_test.py` | `ci` rouge | dit si le test tombé est dans le périmètre de la PR, et s'il passe quand il est rejoué seul |
| Repli hermes | `.github/hermes/a2a.py` | l'API du fournisseur refuse | repose la même question à l'agent `hermes` du daemon ZeroClaw du runner (A2A) |

### Fournisseur de modèle

Le résolveur de conflits interroge une API compatible OpenAI. Par défaut :
**InferHub** (`https://api.inferhub.dev/v1/chat/completions`, modèle
`combo/cheap`). Les variables génériques `MODEL_API_KEY`, `MODEL_API_URL`,
`MODEL_NAME` ont la priorité sur les noms historiques `FIREWORKS_API_KEY`,
`FIREWORKS_BASE_URL`, `FIREWORKS_MODEL` ; le secret du dépôt porte encore le nom
historique.

Si l'API refuse (clé, quota, modèle retiré), le repli interroge l'agent
`hermes` du daemon ZeroClaw local. Si le repli est indisponible, l'erreur
d'origine est conservée, un commentaire est posé et le label
`intervention-humaine` est ajouté — **jamais de CI rouge à cause d'un agent**.

### Garde-fous communs

- empreinte par tête de PR + cooldown, plafond de saisines par période
  (`quota.py`) ;
- périmètre d'écriture : la branche de la PR uniquement — jamais `main`,
  `.github/`, `.mergify.yml` ni les gardes (`REFUSED_PREFIXES`) ;
- une résolution qui ne compile pas n'est jamais poussée
  (`compilation_gate.py`) ;
- les journaux en ajout pur sont réunis sans modèle (`union_journal.py`) ;
- le succès se juge sur l'état réel de la PR (`mergeable_state`), jamais sur le
  récit du modèle ;
- coupe-circuit : `FIREWORKS_AGENT_RESOLVE=0` désactive toute saisine.

## 5. Ce qui ne dépend pas de la CI

Le déploiement des deux apps Forge (`forge deploy`, `forge install`), le
jumelage Capteur ↔ Cerveau et la création réelle des tickets Jira demandent un
tenant Atlassian et un jeton Forge : voir `README.md` et `docs/JUDGES.md`. Tout
ce que les apps calculent est vérifié ici sans tenant, par `npm run replay` et
les tests automatisés.
