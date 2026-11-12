# SIGNATURE-VERSIONING — la pérennité des identifiants de signature

Lot `core-sign`. Ce fichier documente le champ optionnel ajouté à `Signature` et le
chemin de migration ; `docs/CONTRACTS.md` reste inchangé (contrat gelé).

## Le problème

Un identifiant de signature **est** un SHA-256 tronqué de l'erreur normalisée
(`packages/core/src/sign.ts` : `sha256(category | errorType | message | frames)` coupé à
16 hexadécimaux). Si l'algorithme de normalisation évolue, chaque identifiant mémorisé
devient orphelin : les tickets Jira pointent vers des empreintes qui ne se reproduisent
plus, et la mémoire du projet — le cœur de Déjà-vu CI — est perdie.

## La réponse en trois pièces

| Pièce | Fichier | Rôle |
|---|---|---|
| Version | `packages/core/src/signature-version.ts` | `SIGNATURE_ALGORITHM` = `{ name: 'deja-vu-normalized-v1', version: 1 }`, et `signatureIdOf(block, version?)` |
| Serrure | `packages/core/test/signature-golden.test.ts` | 14 blocs d'erreur réels, identifiants figés en dur, pipeline complet rejoué |
| Migration | `packages/core/src/signature-version.ts` | `planSignatureMigration` (pur) + `applySignatureMigration` (idempotent) |

## Le champ optionnel ajouté à `Signature`

```ts
/** Version de l'algorithme de signature qui a produit `id`. Absent = version courante. */
algorithmVersion?: number;
```

Optionnel et rétrocompatible : les signatures déjà mémorisées n'en portent pas, ce qui
signifie « produites par la version courante au moment de l'écriture ». Aucune migration
de données n'est nécessaire pour l'ajouter. Le champ n'est pas encore écrit par le
moteur ; il est là pour qu'un futur changement d'algorithme puisse marquer chaque ligne
sans nouvelle évolution de contrat.

## La serrure (golden test)

`test/signature-golden.test.ts` fige 14 blocs d'erreur couvrant Java/Maven, pytest, Jest,
Go, Rust, .NET, TypeScript, Docker, réseau, npm, timeout, OOM, configuration et lint.
Chaque cas rejoue le **pipeline réel** (`extractErrorBlocks` → masquage → catégorisation →
normalisation → signature) et compare l'identifiant de signature et de famille à une
valeur **relevée depuis le code**, jamais inventée.

Conséquence voulue : quiconque change la normalisation voit ce test casser. La marche à
suivre n'est alors pas de recopier les nouveaux nombres, mais de livrer une migration.

## Le chemin de migration

```ts
const plan = planSignatureMigration(await store.listSignatures(), recompute);
await applySignatureMigration(store, plan);
```

- `recompute(signature) → string` rend l'identifiant de la signature sous l'algorithme
  cible. Le recalcul typique reconstruit un `ErrorBlock` depuis la signature mémorisée
  (`category`, `errorType`, `template` comme message normalisé, `frames`) puis appelle
  `signatureIdOf`.
- `planSignatureMigration` ne retient que les signatures dont l'identifiant bouge, et
  signale les **fusions** dans `plan.merges` : deux anciennes signatures recalculées vers
  le même identifiant deviennent une seule signature, donc un seul ticket.
- `applySignatureMigration` déplace les occurrences, additionne les compteurs, garde la
  `firstSeen` la plus ancienne et la `lastSeen` la plus récente, conserve le `status` le
  plus avancé (`regression > flaky > resolved > known > new`, l'ordre déjà établi par la
  curation) et la clé de ticket existante.
- **Idempotence** : un déplacement dont la signature source ne porte plus aucune
  occurrence est ignoré. Rejouer un plan déjà appliqué ne change rien — prouvé par test,
  y compris sur une fusion. C'est ce qui rend une migration relançable après un arrêt
  brutal.

### Limites connues

- `Store` n'expose aucune suppression. La signature source est donc **vidée**
  (`occurrences: 0`) mais sa ligne subsiste ; c'est l'adaptateur Forge SQL du Cerveau qui
  élaguera les lignes vides.
- La migration porte sur l'identifiant de **signature**. `familyId` n'est pas recalculé :
  il faudrait une seconde fonction de recalcul pour l'empreinte de famille. Le champ est
  conservé tel quel, ce qui reste cohérent pour tout déplacement qui ne change pas la
  famille.

## Normalisation : inchangée dans ce lot

`npm run eval` donne déjà 100 % de regroupement correct, 0 % de faux « instable » et
100 % de catégorie correcte sur le corpus étiqueté. Aucun gain n'est démontrable, et la
contrainte « aucun identifiant existant ne change » interdit de toute façon de retoucher
`normalize.ts` ici. La sortie de `npm run eval` avant et après le lot est identique.
