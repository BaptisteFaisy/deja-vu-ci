# CONTRACTS — Déjà-vu CI (gelé avant le fan-out)

Référence unique pour tous les agents. **Ce fichier et `packages/core/src/types.ts` sont gelés** :
on ne les modifie pas dans une PR de module. Une évolution de contrat se discute d'abord.

Tout le code est en TypeScript strict, ESM, `module: NodeNext` :
**les imports relatifs portent l'extension `.js`** (`import { x } from './sign.js'`), même quand la
source est un `.ts`. Aucun test ne touche au réseau. Aucune dépendance runtime hors `node:*`.

## Découpage des fichiers (propriété exclusive)

Chaque agent ne touche **que** ses fichiers. Toute autre modification est un refus de PR.

| Lot | Propriétaire | Fichiers |
|---|---|---|
| A — extraction | agent A | `packages/core/src/{mask,extract,normalize,categorize,sign}.ts` + `packages/core/test/{mask,extract,normalize,categorize,sign}.test.ts` |
| B — diagnostics | agent B | `packages/core/src/{flaky,outbreak,diagnose}.ts` + `packages/core/test/{flaky,outbreak,diagnose}.test.ts` |
| C — mémoire | agent C | `packages/core/src/{resolutions,tickets,cost}.ts` + `packages/core/test/{resolutions,tickets,cost}.test.ts` |
| D — magasin et rejeu | agent D | `packages/core/src/{store,replay,llm,universal}.ts` + `packages/core/test/{store,replay,llm,universal}.test.ts` |
| E — pont + Capteur | agent E | `packages/bridge/src/*.ts`, `packages/bridge/test/*.test.ts`, `apps/sensor/**` |
| F — Cerveau (serveur) | agent F | `apps/brain/src/{index,ingest,query,universal,consumer,scheduled,settings}.ts`, `apps/brain/manifest.yml`, `apps/brain/package.json`, `apps/brain/tsconfig.json` |
| G — Cerveau (UI, Rovo, MCP) | agent G | `apps/brain/src/ui/**`, `apps/brain/src/rovo/**`, `apps/brain/src/actions/**`, `apps/brain/test/**` |
| H — jeu d'exemple + outils | agent H | `data/**`, `tools/**`, `examples/**` |
| I — documentation | agent I | `docs/**`, `README.md`, `ARCHITECTURE.md` |

Fichiers **gelés** (personne d'autre que `b`) : `package.json`, `tsconfig.base.json`,
`vitest.config.ts`, `packages/*/package.json`, `packages/*/tsconfig.json`,
`packages/core/src/types.ts`, `docs/CONTRACTS.md`, `docs/AGENT-BRIEF.md`,
`.github/**`, `.mergify.yml`, `.gitignore`.

## Règles de taille (règle user 2026-10-24)

- Fichier de code **< 500 lignes** ; fonction **< 50 lignes**. Au-delà : découper.
- Zéro duplication : un helper existe une fois, il est importé.

---

## A — `mask.ts`

```ts
export interface MaskResult { text: string; masked: number; kinds: string[] }
export function maskSecrets(text: string): MaskResult;
export function containsSecret(text: string): boolean;
```

Motifs à masquer (§ 18 « Secrets ») : jetons GitHub (`ghp_`, `gho_`, `ghs_`, `github_pat_`),
jetons Atlassian, `Authorization: Bearer …`, JWT (`eyJ…`), clés AWS (`AKIA…`), blocs
`-----BEGIN … PRIVATE KEY-----`, `motdepasse:xxx@` dans les URL, chaînes de connexion
(`postgres://user:pass@…`), jetons npm (`npm_…`), jetons Slack (`xox[baprs]-…`), adresses
de messagerie, et toute chaîne hex/base64 de plus de 32 caractères qui ressemble à un secret.
Remplacement par un jeton neutre stable : `«[masqué:type]»`. Le masquage est **idempotent**.

## A — `extract.ts`

```ts
export interface ExtractInput { stepLog?: string; testCases?: FailedTestCase[]; maxTotalBytes?: number }
export function extractErrorBlocks(input: ExtractInput): ExtractResult;
export function lastNonEmptyLines(text: string, n: number): string[];
```

Ordre de préférence (§ 9.1) : (1) `testCases` → un bloc par cas échoué, `source: 'report'` ;
(2) motifs du journal (`source: 'log'`) ; (3) les 80 dernières lignes non vides (`source: 'tail'`).
Au plus **3 blocs distincts** retenus (§ 19) et **50 Ko** au total (`maxTotalBytes`, 51200 par défaut).
`dropped` compte les blocs distincts écartés. Motifs à reconnaître : JUnit, pytest, Jest, Go,
Cargo, npm, Gradle, Maven, TypeScript, ESLint, Docker, mémoire insuffisante, délai dépassé,
erreurs réseau.

## A — `normalize.ts`

```ts
export function stripAnsi(text: string): string;
export function normalizeMessage(message: string): string;
export function normalizeFrames(frames: Frame[], maxProject?: number): Frame[];
```

Normalisation (§ 9.2) : horodatages (ISO 8601, `HH:MM:SS`, RFC 2822), durées (`123ms`, `1.2 s`,
`3 min`), dates, adresses mémoire (`0x7f…`), UUID, empreintes de commit (40 hex), identifiants
hexadécimaux (≥ 8), chemins temporaires (`/tmp/…`, `/var/folders/…`, `C:\Users\…`), noms de
conteneurs, ports (`:8080`), **numéros de ligne** (on garde fichier et fonction), nombres isolés,
codes de couleur ANSI. Chaque remplacement utilise un jeton neutre documenté en tête de fichier.
`normalizeFrames` garde les **5 premières** lignes `isProject: true`.

## A — `categorize.ts`

```ts
export interface CategorizeInput { rawText: string; source: ExtractSource; testName?: string; errorType?: string }
export function categorize(input: CategorizeInput): Category;
export function detectErrorType(rawText: string): string;
```

Les huit catégories du § 9.4. `detectErrorType` rend un type canonique (`AssertionError`,
`CompileError`, `LintError`, `DependencyResolution`, `NetworkError`, `OutOfMemory`, `Timeout`,
`ConfigError`, `UnknownError`…).

## A — `sign.ts`

```ts
export function signatureOf(block: ErrorBlock): string;   // 16 hex
export function familyOf(block: ErrorBlock): string;      // 16 hex
export function signatureKeys(block: ErrorBlock): SignatureKey;
export function signatureShort(id: string): string;       // « S-204 »
```

`sha256(category | errorType | message | frames)` tronqué à 16 hex ; la famille omet `frames`.
`signatureShort` = `S-` + 3 derniers chiffres décimaux dérivés de l'empreinte (stable, lisible).

## B — `flaky.ts`

```ts
export function assessFlakiness(occs: Occurrence[], opts?: { settings?: Partial<Settings>; now?: Date }): FlakyVerdict;
export function flakyIndex(occs: Occurrence[]): number;
export function testStats(occs: Occurrence[], testName: string): TestStats;
```

§ 10.1 : fenêtre glissante de `flakyWindowDays` (14) ; instable si ≥ `flakyMinOccurrences` (3)
occurrences sur ≥ `flakyMinBranches` (2) branches **et** au moins un succès au même commit après
un échec. `flakyIndex` = part des échecs sans modification pertinente (0..1), sert au classement.

## B — `outbreak.ts`

```ts
export function detectOutbreak(occs: Occurrence[], opts?: { settings?: Partial<Settings>; now?: Date }): Outbreak | undefined;
```

§ 10.3 : même famille sur ≥ `outbreakRepos` (3) dépôts en ≤ `outbreakWindowMin` (15) minutes.

## B — `diagnose.ts`

```ts
export function diagnose(ctx: DiagnoseContext): Diagnostic;
```

Ordre d'évaluation : infrastructure (catégorie ou épidémie) → déjà corrigé (résolution présente
et absente de la branche) → instable connu → nouveau → incertain. Chaque verdict porte
`confidence` (0..1), `facts` (au moins un fait), `title` (≤ 90 caractères) et `summary`.
Sous `minConfidenceNotYourFault` (0,75), un verdict « sans rapport avec ta PR » devient
`uncertain` avec `action: 'none'` et les faits conservés (§ 18 « Prudence »).

## C — `resolutions.ts`

```ts
export interface CandidateCommit { sha: string; author: string; files: string[]; message: string }
export interface CandidateInput { signatureId: string; history: Occurrence[]; commitsBetween: CandidateCommit[]; linkedIssueKey?: string; now?: Date }
export function inferCandidateResolution(input: CandidateInput): Resolution | undefined;
export function detectRegression(signature: Signature, occurrence: Occurrence, resolution?: Resolution): boolean;
```

§ 10.5 : candidats = commits entre le dernier échec et le premier succès ; priorité à ceux qui
touchent un fichier de la pile ou citent le ticket lié ; `confidence` faible (< 0,6) tant que non
confirmé. `detectRegression` : signature `resolved` qui réapparaît (§ 8.4).

## C — `tickets.ts`

```ts
export interface TicketPlanInput { signature: Signature; occurrences: Occurrence[]; verdict?: FlakyVerdict; existingIssueKey?: string; lastCommentAt?: string; now?: Date; settings?: Partial<Settings> }
export function planTicketActions(input: TicketPlanInput): TicketAction[];
export function dailySynthesis(signature: Signature, occurrences: Occurrence[], now?: Date): string;
```

§ 11 : clé d'unicité = **famille** ; création au passage à « instable » ou sur demande ; **un seul**
commentaire de synthèse par jour et par ticket ; clôture suggérée après 14 jours sans occurrence ;
réouverture sur régression. Le tableau des occurrences (date, dépôt, branche, lien) et le coût sont
dans `description`.

## C — `cost.ts`

```ts
export function computeCost(occs: Occurrence[], opts?: { windowDays?: number; signatures?: Signature[]; now?: Date }): CostReport;
```

CI-14 : builds rouges, minutes de CI perdues (somme des `durationS` + relances), personnes
touchées (auteurs distincts), relances, et le détail par signature trié par coût décroissant.

## D — `store.ts`

```ts
export interface Store { /* voir ci-dessous */ }
export class MemoryStore implements Store { constructor(seed?: { signatures?: Signature[]; occurrences?: Occurrence[]; resolutions?: Resolution[] }) }
export const SQL_SCHEMA: string;
```

```ts
saveSignature(s: Signature): Promise<void>;
getSignature(id: string): Promise<Signature | undefined>;
listSignatures(): Promise<Signature[]>;
findSignaturesByFamily(familyId: string): Promise<Signature[]>;
saveOccurrence(o: Occurrence): Promise<void>;
listOccurrences(signatureId: string): Promise<Occurrence[]>;
listFamilyOccurrences(familyId: string): Promise<Occurrence[]>;
saveResolution(r: Resolution): Promise<void>;
getResolution(signatureId: string): Promise<Resolution | undefined>;
saveRawExcerpt(e: RawExcerpt): Promise<void>;
purgeExpired(now: Date): Promise<number>;
getSettings(): Promise<Settings>;
saveSettings(s: Settings): Promise<void>;
listTestStats(repo?: string): Promise<TestStats[]>;
saveTestStats(t: TestStats): Promise<void>;
saveOutbreak(o: Outbreak): Promise<void>;
findOutbreak(familyId: string): Promise<Outbreak | undefined>;
```

`SQL_SCHEMA` = le DDL Forge SQL du § 16 (tables `signature`, `occurrence`, `test_stats`,
`resolution`, `raw_excerpt`, `llm_template_cache`, `outbreak`, `pairing`, `settings`), avec les
index sur `signature.family_id` et `occurrence(signature_id, occurred_at)`, sans clés étrangères.
Chaque requête d'écran doit tenir dans les 5 s d'un SELECT.

## D — `replay.ts`

```ts
export function replay(dataset: SampleDataset, opts?: { settings?: Partial<Settings>; now?: Date }): Promise<ReplayResult>;
```

Rejeu déterministe : chaque `SampleOccurrence` d'échec passe par extraction → signature →
diagnostic → plan de tickets, en respectant l'ordre chronologique et en alimentant un
`MemoryStore`. Les `success` servent à noter « a réussi au même commit » et à déduire les
résolutions candidates. Le résultat contient les quatre diagnostics attendus (§ 22).

## D — `llm.ts`

```ts
export interface LlmFallback { complete(prompt: string): Promise<string> }
export interface LlmNormalizeResult { template: string; category: Category }
export class TemplateCache { get(hash: string): LlmNormalizeResult | undefined; set(hash: string, value: LlmNormalizeResult): void; readonly size: number }
export function llmNormalize(block: ErrorBlock, llm: LlmFallback, cache: TemplateCache): Promise<LlmNormalizeResult>;
```

§ 9.5 : le modèle ne sert qu'en secours, quand aucun motif n'a reconnu le bloc. Cache par texte
normalisé (`sha256`) : une même erreur brute n'est jamais soumise deux fois. Si le modèle répond
hors format, repli déterministe (jamais d'exception).

## D — `universal.ts`

```ts
export function parseUniversalPayload(body: unknown): { ok: true; payload: UniversalPayload } | { ok: false; error: string };
export function universalToIngest(payload: UniversalPayload, opts?: { settings?: Partial<Settings>; now?: Date }): IngestPayload;
```

CI-16 : valide les champs, borne le journal à 50 Ko, applique le masquage, et produit une charge
utile `IngestPayload` prête pour le même chemin que le Capteur.

---

## E — `packages/bridge` (pont signé)

```ts
export const BRIDGE_HEADERS: { signature: string; timestamp: string; nonce: string };
export interface BridgeEnvelope { v: 1; nonce: string; ts: number; payload: unknown }
export function signPayload(payload: unknown, secret: string, opts?: { now?: Date; nonce?: string }): { body: string; headers: Record<string, string> };
export function verifyRequest(headers: Record<string, string | undefined>, body: string, secret: string, opts?: { now?: Date; maxSkewS?: number; seenNonce?: (nonce: string) => boolean }): { ok: boolean; reason?: string; payload?: unknown };
```

§ 15 : HMAC-SHA256 du corps, horodatage, numéro unique (nonce), secret partagé du jumelage.
`verifyRequest` refuse : signature absente/mauvaise, horodatage hors fenêtre (`maxSkewS` 300 s),
nonce déjà vu (`seenNonce`), corps > 5 Mo. Comparaison à temps constant (`timingSafeEqual`).

## E — `apps/sensor` (app Forge Bitbucket)

- `manifest.yml` : module déclencheur `avi:bitbucket:created:build-status` et
  `avi:bitbucket:updated:build-status`, carte de PR, page de réglages d'espace de travail ;
  scopes `read:repository:bitbucket`, `read:pipeline:bitbucket`, `read:pullrequest:bitbucket`,
  `storage:app` ; `external.fetch.backend: ['*.webtrigger.atlassian.app']`.
- `src/`: `index.ts` (résolveurs), `pipelines.ts` (lecture du journal par requête partielle et des
  rapports de tests), `buildPayload.ts` (masquage + payload), `settings.ts`, `ancestry.ts`
  (comparaison d'ancêtres pour § 10.2).
- Toute logique testable reste **pure** et sans import `@forge/api` dans `apps/sensor/src/pure/`,
  testée par `apps/sensor/test/*.test.ts`.

## F — `apps/brain` (app Forge Jira, serveur)

- `manifest.yml` : `webtrigger` (trois routes : `/ingest`, `/query`, `/universal`), `consumer`,
  `scheduledTrigger`, `sql`, `llm`, `jira:projectPage`, `jira:issueContext`,
  `jira:projectSettingsPage`, `rovo:agent`, `action`, `rovo:mcp`.
- `src/index.ts` : exporte `ingest`, `query`, `universal`, `consumer`, `scheduled`, `projectPage`,
  `issueContext`, `settingsPage`, et les six actions du § 13.
- Le Cerveau ne fait que **câbler** : toute la logique vient de `@dejavu/core`.

## G — `apps/brain` (UI, Rovo, MCP)

- `src/ui/` : page projet « Mémoire de CI » (tableau des signatures, filtres, recherche, onglets
  Tests instables / Résolutions à confirmer / Coût), encart ticket, page de réglages — en
  `@forge/react` (UI Kit).
- `src/actions/` : les six actions `explain-build-failure`, `search-failures`, `get-signature`,
  `list-flaky-tests`, `report-resolution`, `confirm-resolution` (verbe, entrées, retour du § 13).
- `src/rovo/` : définition de l'agent « Déjà-vu CI » (instructions + actions), et exposition
  `rovo:mcp` des mêmes actions.
- Tests : `apps/brain/test/*.test.ts`, sans import `@forge/react`.

## H — jeu d'exemple et outils

- `data/sample/occurrences.json` : **40 échecs sur 14 jours** (`SampleDataset`) produisant les
  quatre diagnostics, avec les `expected` renseignés (recette § 20).
- `data/labeled/100-failures.json` : **100 échecs étiquetés** (`LabeledCorpus`), au moins 20
  groupes distincts, dont des paires qui ne diffèrent que par l'horodatage et le numéro de ligne.
- `tools/replay.mjs` : `npm run replay` — rejoue le jeu d'exemple sur un magasin mémoire et
  affiche signatures, diagnostics, tickets, puis les quatre compteurs.
- `tools/eval-accuracy.mjs` : `npm run eval` — mesure regroupement et faux « instable » (§ 18).
- `tools/universal-entry.sh` : la commande d'une ligne pour n'importe quelle CI (§ 15).
- `examples/flaky-repo/` : le dépôt de démonstration à pousser sur Bitbucket (un test
  volontairement aléatoire, une régression réelle, une dépendance vers un registre coupé).

## I — documentation

`README.md` (instructions pour les juges, § 22), `docs/ARCHITECTURE.md` (+ `docs/architecture.svg`),
`docs/JUDGES.md`, `docs/DEMO.md` (script vidéo 5 min, § 21), `docs/ROADMAP.md` (V1 et vision),
`docs/ADRs/` (décisions : deux apps jumelées, mémoire côté Jira, signature déterministe d'abord).
Le cahier des charges d'origine reste `docs/cahier-des-charges.md`, en français.
