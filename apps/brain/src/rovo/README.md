# Agent Rovo et serveur MCP — Déjà-vu CI

Ce dossier expose la mémoire de CI aux agents : l'agent Rovo « Déjà-vu CI »
(`agent.ts`) et le serveur `rovo:mcp` (`mcp.ts`). Les deux partagent **exactement
les mêmes six actions** que le module `action` de Forge — mêmes clés, mêmes
entrées, mêmes sorties.

## Les six actions

| Clé | Verbe | Entrées | Retour |
|---|---|---|---|
| `explain-build-failure` | GET | `issueKey` ou `buildUrl` | diagnostic, confiance, justification, action proposée |
| `search-failures` | GET | `text`, `repository` (facultatif) | signatures proches d'un extrait d'erreur |
| `get-signature` | GET | `signatureId` | historique, statut, résolution, ticket |
| `list-flaky-tests` | GET | `repository`, `days` | tests instables classés par coût |
| `report-resolution` | CREATE | `signatureId`, `commit`, `note` | résolution enregistrée (candidate) |
| `confirm-resolution` | UPDATE | `signatureId`, `confirmed` | résolution confirmée ou rejetée |

Chaque action rend `{ ok: true, data }` ou `{ ok: false, error }`. Aucune
exception ne remonte : un agent qui passe un champ manquant reçoit un message
qui dit quoi corriger.

## Appeler les actions depuis un agent de code

### Par le serveur MCP (`rovo:mcp`)

Le serveur MCP expose chaque action comme un outil. L'agent de code choisit
l'outil, envoie ses entrées en JSON et lit la sortie :

```json
{
  "tool": "explain-build-failure",
  "input": { "issueKey": "PAY-123" }
}
```

Réponse :

```json
{
  "ok": true,
  "data": {
    "diagnostic": {
      "kind": "flaky",
      "confidence": 0.95,
      "title": "Known flaky test, seen 17 times on 9 branches",
      "action": "retry",
      "issueKey": "PAY-88",
      "facts": [{ "label": "occurrences", "value": "17" }]
    },
    "confidence": 0.95,
    "justification": ["occurrences: 17", "branches: 9"],
    "action": "retry"
  }
}
```

L'agent lit `data.action` et agit : `retry` → relancer, `rebase` → reprendre le
correctif cité, `fix` → corriger, `wait` → infrastructure, `none` → rien à faire.

### Par l'agent Rovo

L'agent « Déjà-vu CI » répond aux quatre questions types du § 13 :

- « Pourquoi le build de PAY-123 est-il rouge ? » → `explain-build-failure`
- « A-t-on déjà vu cette erreur ? » → `search-failures`
- « Quels sont nos tests les plus instables ? » → `list-flaky-tests`
- « Qui a corrigé l'erreur de connexion à la base la dernière fois ? » →
  `search-failures`, puis `get-signature` pour la résolution.

## Règles que l'agent respecte

1. Il répond avec un diagnostic **et** une action, jamais par une supposition.
2. Il cite le ticket du problème quand il existe.
3. Il ne dit jamais « sans rapport avec ta PR » sous le seuil de confiance : le
   moteur a alors dégradé le verdict en « incertain », l'agent ne le réécrit pas.
4. Il n'invente ni commit, ni auteur, ni ticket.

## Dans le code

```ts
import { callTool } from './mcp.js';
import { describeAgent } from './agent.js';

const answer = await callTool(engine, 'list-flaky-tests', { repository: 'web', days: 14 });
const agent = describeAgent(); // nom, instructions, liste des actions
```

L'objet `engine` porte la mémoire : `engine.store` (magasin) et les fonctions du
moteur (`diagnose`, `extractErrorBlocks`, `signatureKeys`, `assessFlakiness`,
`computeCost`). Il est assemblé une fois par `createBrainEngine` et partagé par
les actions, les écrans et le serveur MCP.
