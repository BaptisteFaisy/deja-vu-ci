/**
 * Panneau « Curation & quarantaine » — manipuler la mémoire pour de vrai.
 *
 * Le visiteur choisit des signatures de la mémoire de la page et actionne les
 * quatre gestes du produit : fusionner (CI-17), scinder (CI-17), comparer deux
 * gabarits pour obtenir la règle de normalisation manquante, et demander une
 * proposition de quarantaine (CI-19). Chaque geste appelle les fonctions du
 * moteur (`packages/core`) : rien n'est recalculé ni imité ici.
 *
 * Les opérations sont **destructives** pour la mémoire de la page — d'où le
 * bouton « réinitialiser », qui rejoue le jeu d'exemple dans une mémoire neuve
 * (`workspace.reload()`), et l'appel à `workspace.notify()` après chaque
 * application pour que l'onglet « Rejeu » montre la même mémoire modifiée.
 *
 * Le rendu est synchrone (contrat `Panel`) : la mémoire est lue une fois au
 * montage, puis chaque geste recharge l'état et redessine. La logique vit dans
 * `curate-ops.ts` (pure, testée) et la mise en forme dans `curate-view.ts`.
 */

import { el, mount } from '../render/dom';
import { fill, registerStrings, t } from '../lib/i18n';
import type { Workspace } from '../state/workspace';
import * as ops from './curate-ops';
import {
  memoryCard,
  mergeCard,
  quarantineCard,
  ruleCard,
  splitCard,
  type CurateHandlers,
  type CurateState,
} from './curate-view';
import type { Panel, PanelContext } from './types';

registerStrings({
  'panel.curate.title': ['Curation & quarantine', 'Curation et quarantaine'],
  'panel.curate.summary': [
    'Merge or split two signatures, get the missing normalization rule and the quarantine proposal of a flaky test — the real engine, on the memory of this page.',
    'Fusionnez ou scindez deux signatures, obtenez la règle de normalisation manquante et la proposition de quarantaine d’un test instable — le vrai moteur, sur la mémoire de cette page.',
  ],

  'curate.memory.title': ['The memory of this page', 'La mémoire de cette page'],
  'curate.memory.note': [
    'Every gesture below really rewrites the memory the “Replay” tab reads: the same in-memory store the engine fills. Merging or splitting is destructive here — the reset button replays the sample set from scratch.',
    'Chaque geste ci-dessous réécrit vraiment la mémoire que lit l’onglet « Rejeu » : le même magasin en mémoire que le moteur remplit. Fusionner ou scinder est destructif ici — le bouton de réinitialisation rejoue le jeu d’exemple à zéro.',
  ],
  'curate.snapshot.tickets': ['Distinct tickets', 'Tickets distincts'],
  'curate.reset': ['Reset the memory', 'Réinitialiser la mémoire'],
  'curate.honesty': [
    'What this page cannot do: the Jira app exposes the same merge and split as previews (`curate-merge`, `curate-split` resolvers) — writing to Forge SQL, creating the repair ticket or committing the isolation needs a real tenant.',
    'Ce que cette page ne peut pas faire : l’app Jira expose la même fusion et la même scission en prévisualisation (résolveurs `curate-merge`, `curate-split`) — écrire dans le SQL Forge, créer le ticket de réparation ou commiter l’isolation demande un vrai tenant.',
  ],

  'curate.merge.title': ['Merge two signatures', 'Fusionner deux signatures'],
  'curate.merge.note': [
    'The kept signature provides the identity and the ticket; the absorbed one is retired. Its occurrences are reattached, its history is unioned, and the status follows the engine precedence: {order}.',
    'La signature conservée fournit l’identité et le ticket ; l’autre est retirée. Ses occurrences sont réaffectées, son histoire est réunie, et le statut suit la précédence du moteur : {order}.',
  ],
  'curate.merge.keep': ['Kept signature', 'Signature conservée'],
  'curate.merge.drop': ['Absorbed signature', 'Signature absorbée'],
  'curate.merge.preview': ['Preview the merge', 'Prévisualiser la fusion'],
  'curate.merge.apply': ['Apply the merge', 'Appliquer la fusion'],
  'curate.merge.moved': ['Occurrences reattached', 'Occurrences réaffectées'],
  'curate.merge.none': ['Pick two different signatures, then preview the merge.', 'Choisissez deux signatures différentes, puis prévisualisez la fusion.'],

  'curate.split.title': ['Split one signature', 'Scinder une signature'],
  'curate.split.note': [
    'The occurrences are distributed by the chosen criterion. The biggest group keeps the original fingerprint and its ticket; the others get a new fingerprint, because they are by definition another problem.',
    'Les occurrences sont réparties selon le critère choisi. Le plus gros groupe garde l’empreinte d’origine et son ticket ; les autres reçoivent une nouvelle empreinte, car ce sont par définition d’autres problèmes.',
  ],
  'curate.split.signature': ['Signature to split', 'Signature à scinder'],
  'curate.split.criterion': ['Criterion', 'Critère'],
  'curate.criterion.test-name': ['Test name', 'Nom du test'],
  'curate.criterion.branch': ['Branch', 'Branche'],
  'curate.criterion.repository': ['Repository', 'Dépôt'],
  'curate.criterion.function': ['Pipeline step', 'Étape du pipeline'],
  'curate.split.preview': ['Preview the split', 'Prévisualiser la scission'],
  'curate.split.apply': ['Apply the split', 'Appliquer la scission'],
  'curate.split.group': ['Group', 'Groupe'],
  'curate.split.origin': ['Fingerprint', 'Empreinte'],
  'curate.split.kept': ['Keeps the original', 'Garde l’originale'],
  'curate.split.derived': ['New, derived', 'Nouvelle, dérivée'],
  'curate.split.none': ['Pick a signature and a criterion, then preview the split.', 'Choisissez une signature et un critère, puis prévisualisez la scission.'],
  'curate.split.one': ['One single group: this criterion separates nothing here.', 'Un seul groupe : ce critère ne sépare rien ici.'],

  'curate.rule.title': ['The missing normalization rule', 'La règle de normalisation manquante'],
  'curate.rule.note': [
    'Two signatures born from the same error differ by one volatile word. The engine isolates it, proposes the regex and the neutral token — and says whether the existing table of `normalize.ts` already covers it.',
    'Deux signatures nées de la même erreur diffèrent d’un mot volatile. Le moteur l’isole, propose la regex et le jeton neutre — et dit si la table existante de `normalize.ts` le couvre déjà.',
  ],
  'curate.rule.a': ['First signature', 'Première signature'],
  'curate.rule.b': ['Second signature', 'Seconde signature'],
  'curate.rule.compare': ['Compare the templates', 'Comparer les gabarits'],
  'curate.rule.token': ['Differing token', 'Jeton qui diffère'],
  'curate.rule.pattern': ['Proposed pattern', 'Motif proposé'],
  'curate.rule.replacement': ['Neutral token', 'Jeton neutre'],
  'curate.rule.covered': ['Covered by the normalizer', 'Couvert par le normaliseur'],
  'curate.rule.coveredYes': ['Already covered', 'Déjà couvert'],
  'curate.rule.toAdd': ['To add to the table', 'À ajouter à la table'],
  'curate.rule.none': ['The two templates are identical: nothing to normalize.', 'Les deux gabarits sont identiques : rien à normaliser.'],

  'curate.quarantine.title': ['Quarantine a flaky test', 'Mettre un test instable en quarantaine'],
  'curate.quarantine.note': [
    'Only a test the engine really calls unstable gets a proposal: `assessFlakiness` is the single authority. A genuinely broken test gets nothing — quarantining it would hide a defect. Nothing is written to a repository and no ticket is created: both are drafted.',
    'Seul un test que le moteur déclare vraiment instable reçoit une proposition : `assessFlakiness` est la seule autorité. Un test vraiment cassé n’obtient rien — le mettre en quarantaine masquerait un défaut. Rien n’est écrit dans un dépôt et aucun ticket n’est créé : les deux sont rédigés.',
  ],
  'curate.quarantine.signature': ['Signature to assess', 'Signature à évaluer'],
  'curate.quarantine.propose': ['Ask the engine', 'Interroger le moteur'],
  'curate.quarantine.notFlaky': ['Not unstable: the engine proposes nothing, and here is why.', 'Pas instable : le moteur ne propose rien, et voici pourquoi.'],
  'curate.quarantine.branches': ['branches', 'branches'],
  'curate.quarantine.flakyIndex': ['Flaky index', 'Indice d’instabilité'],
  'curate.quarantine.snippet': ['The isolation, in the idiom of the ecosystem', 'L’isolation, dans l’idiome de l’écosystème'],
  'curate.quarantine.file': ['File', 'Fichier'],
  'curate.quarantine.ticket': ['The repair ticket that would be created', 'Le ticket de réparation qui serait créé'],
  'curate.quarantine.assignee': ['Suggested owner', 'Propriétaire suggéré'],
  'curate.quarantine.due': ['Repair deadline', 'Échéance de réparation'],
  'curate.quarantine.days': ['days', 'jours'],
  'curate.quarantine.cost': ['Cost of the flakiness', 'Coût de l’instabilité'],
  'curate.quarantine.worth': ['Worth quarantining', 'La quarantaine vaut le coup'],
  'curate.quarantine.notWorth': ['Below the thresholds', 'Sous les seuils'],
  'curate.quarantine.thresholds': [
    'Engine thresholds: {minutes} CI minutes lost, or a flaky index of {index}, or {occurrences} occurrences; repair within {days} days.',
    'Seuils du moteur : {minutes} minutes de CI perdues, ou un indice d’instabilité de {index}, ou {occurrences} occurrences ; réparation sous {days} jours.',
  ],

  'curate.applied': ['Applied to the memory of this page.', 'Appliqué à la mémoire de cette page.'],
  'curate.beforeAfter': [
    'Before → after: {signaturesBefore} → {signaturesAfter} signatures, {occurrencesBefore} → {occurrencesAfter} occurrences, {ticketsBefore} → {ticketsAfter} tickets.',
    'Avant → après : {signaturesBefore} → {signaturesAfter} signatures, {occurrencesBefore} → {occurrencesAfter} occurrences, {ticketsBefore} → {ticketsAfter} tickets.',
  ],
  'curate.busy': ['The engine is working…', 'Le moteur travaille…'],
  'curate.error': ['The gesture failed: {error}', 'Le geste a échoué : {error}'],
});

/** Le premier identifiant d'une liste, ou une chaîne vide. */
function firstId(signatures: Array<{ id: string }>, index = 0): string {
  return signatures[index]?.id ?? '';
}

/**
 * L'état initial d'un rendu : les listes déroulantes pointent sur des
 * signatures différentes, pour qu'un premier clic produise quelque chose.
 */
function initialState(signatures: Array<{ id: string }>): Partial<CurateState> {
  return {
    keepId: firstId(signatures, 0),
    dropId: firstId(signatures, 1),
    splitId: firstId(signatures, 0),
    ruleA: firstId(signatures, 0),
    ruleB: firstId(signatures, 1),
    quarantineId: firstId(signatures, 0),
    criterion: 'test-name',
  };
}

/** Vide tous les résultats affichés (réinitialisation de la mémoire). */
function clearResults(state: CurateState): void {
  state.mergePreview = undefined;
  state.mergeApplied = undefined;
  state.splitPreview = undefined;
  state.splitApplied = undefined;
  state.rule = undefined;
  state.quarantine = undefined;
}

/** Une signature retirée de la mémoire ne peut plus être sélectionnée. */
function pruneSelections(state: CurateState): void {
  const known = new Set(state.signatures.map((signature) => signature.id));
  for (const field of ['keepId', 'dropId', 'splitId', 'ruleA', 'ruleB', 'quarantineId'] as const) {
    if (!known.has(state[field])) state[field] = firstId(state.signatures);
  }
}

/** Le moteur du panneau : recharger la mémoire, exécuter un geste, redessiner. */
interface CurateUi {
  state: CurateState;
  handlers?: CurateHandlers;
  draw(): void;
  reloadMemory(): Promise<void>;
  run(gesture: () => Promise<void>, keepSelections?: boolean): Promise<void>;
}

/** Construit le moteur du panneau (rendu + gestes asynchrones). */
function createUi(host: HTMLElement, ctx: PanelContext, state: CurateState): CurateUi {
  const { workspace, lang } = ctx;
  const ui: CurateUi = {
    state,
    draw() {
      const handlers = ui.handlers;
      if (!handlers) return;
      mount(
        host,
        el(
          'div',
          {},
          memoryCard(state, lang, handlers),
          mergeCard(state, lang, handlers),
          splitCard(state, lang, handlers),
          ruleCard(state, lang, handlers),
          quarantineCard(state, lang, handlers),
        ),
        state.busy ? el('p', { class: 'status' }, t('curate.busy', lang)) : null,
        state.error
          ? el('p', { class: 'status error' }, fill(t('curate.error', lang), { error: state.error }))
          : null,
      );
    },
    async reloadMemory() {
      state.signatures = await workspace.store.listSignatures();
      state.snapshot = await ops.snapshotOf(workspace.store);
    },
    async run(gesture, keepSelections = true) {
      state.busy = true;
      state.error = undefined;
      ui.draw();
      try {
        await gesture();
        await ui.reloadMemory();
        if (!keepSelections) Object.assign(state, initialState(state.signatures));
        pruneSelections(state);
        await workspace.notify();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.busy = false;
        ui.draw();
      }
    },
  };
  return ui;
}

/** Exécute une opération du moteur et range sa réponse dans l'état. */
function runOps<T>(
  ui: CurateUi,
  op: () => Promise<ops.OpsAnswer<T>>,
  slot: (data: T) => void,
  keepSelections = true,
): void {
  void ui.run(async () => {
    const answer = await op();
    if (answer.ok) slot(answer.data);
    else ui.state.error = answer.error;
  }, keepSelections);
}

/** Les sélections : tout changement vide le résultat de sa section. */
function selectorHandlers(ui: CurateUi): Pick<CurateHandlers, 'onKeep' | 'onDrop' | 'onSplit' | 'onCriterion' | 'onRuleA' | 'onRuleB' | 'onQuarantine'> {
  const state = ui.state;
  const clearMerge = (): void => {
    state.mergePreview = undefined;
    state.mergeApplied = undefined;
  };
  const clearSplit = (): void => {
    state.splitPreview = undefined;
    state.splitApplied = undefined;
  };
  return {
    onKeep: (id) => { state.keepId = id; clearMerge(); ui.draw(); },
    onDrop: (id) => { state.dropId = id; clearMerge(); ui.draw(); },
    onSplit: (id) => { state.splitId = id; clearSplit(); ui.draw(); },
    onCriterion: (key) => { state.criterion = key; clearSplit(); ui.draw(); },
    onRuleA: (id) => { state.ruleA = id; state.rule = undefined; ui.draw(); },
    onRuleB: (id) => { state.ruleB = id; state.rule = undefined; ui.draw(); },
    onQuarantine: (id) => { state.quarantineId = id; state.quarantine = undefined; ui.draw(); },
  };
}

/** Les gestes : chaque bouton appelle le moteur, jamais une copie du moteur. */
function buildHandlers(ui: CurateUi, workspace: Workspace): CurateHandlers {
  const state = ui.state;
  const store = workspace.store;
  return {
    ...selectorHandlers(ui),
    previewMerge: () => {
      state.mergeApplied = undefined;
      runOps(ui, () => ops.mergePreview(store, state.keepId, state.dropId), (data) => { state.mergePreview = data; });
    },
    applyMerge: () => runOps(
      ui,
      () => ops.applyMerge(store, state.keepId, state.dropId),
      (data) => { state.mergeApplied = data; state.mergePreview = undefined; },
      false,
    ),
    previewSplit: () => {
      state.splitApplied = undefined;
      runOps(ui, () => ops.splitPreview(store, state.splitId, state.criterion), (data) => { state.splitPreview = data; });
    },
    applySplit: () => runOps(
      ui,
      () => ops.applySplit(store, state.splitId, state.criterion),
      (data) => { state.splitApplied = data; state.splitPreview = undefined; },
    ),
    compareRules: () => runOps(ui, () => ops.ruleBetween(store, state.ruleA, state.ruleB), (data) => { state.rule = data; }),
    proposeQuarantine: () => runOps(
      ui,
      () => ops.quarantineOf(store, state.quarantineId, workspace.now),
      (data) => { state.quarantine = data; },
    ),
    reset: () => runOps(ui, async () => {
      await workspace.reload();
      clearResults(state);
      return { ok: true, data: undefined } as const;
    }, () => {}, false),
  };
}

/** Premier chargement : lit la mémoire, pose les sélections, sort de « en cours ». */
async function bootstrap(ui: CurateUi): Promise<void> {
  const state = ui.state;
  try {
    await ui.reloadMemory();
    Object.assign(state, initialState(state.signatures));
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    ui.draw();
  }
}

/** Le panneau : état neuf à chaque rendu (contrat `Panel` : idempotent). */
function curatePanel(host: HTMLElement, ctx: PanelContext): void {
  const state: CurateState = {
    signatures: [],
    keepId: '',
    dropId: '',
    splitId: '',
    criterion: 'test-name',
    ruleA: '',
    ruleB: '',
    quarantineId: '',
    busy: true,
  };
  const ui = createUi(host, ctx, state);
  ui.handlers = buildHandlers(ui, ctx.workspace);
  ui.draw();
  void bootstrap(ui);
}

export const panel: Panel = {
  id: 'curate',
  title: (lang) => t('panel.curate.title', lang),
  summary: (lang) => t('panel.curate.summary', lang),
  render(host, ctx) {
    curatePanel(host, ctx);
  },
};
