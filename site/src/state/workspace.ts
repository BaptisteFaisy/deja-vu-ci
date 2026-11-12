/**
 * L'atelier partagé du site : une mémoire, un moteur, une horloge.
 *
 * Les panneaux ne rejouent pas chacun le jeu d'exemple : ils partagent **la
 * même** mémoire en mémoire (`MemoryStore`), le même moteur (`packages/core`)
 * et le même moteur d'actions du Cerveau (`apps/brain/src/actions/engine`).
 * Ainsi, quand le panneau « curation » fusionne deux signatures, le panneau
 * « rejeu » et la console Rovo voient la même mémoire modifiée — exactement
 * comme dans l'app réelle.
 *
 * Les modules importés depuis `apps/**` sont ceux que leurs propres tests
 * utilisent : aucun import `@forge/*`, donc rien à simuler. Le site montre le
 * vrai code du produit, pas une copie.
 */

import {
  MemoryStore,
  assessFlakiness,
  computeCost,
  diagnose,
  extractErrorBlocks,
  replayWithEngine,
  signatureKeys,
  signatureShort,
  staticReplayEngine,
  type ReplayEngine,
  type ReplayResult,
} from '@dejavu/core';
import {
  createBrainEngine,
  type BrainEngine,
  type CoreFunctions,
} from '../../../apps/brain/src/actions/engine';
import { SAMPLE, demoNow, viewOf, type DemoRun } from '../lib/demo';

/** Les fonctions du moteur que le Cerveau injecte dans ses actions. */
const CORE: CoreFunctions = {
  diagnose,
  extractErrorBlocks,
  signatureKeys,
  assessFlakiness,
  computeCost,
  signatureShort,
};

/** Ce que les panneaux reçoivent : mémoire, moteurs, vue dérivée, horloge. */
export interface Workspace {
  /** La mémoire du rejeu — les panneaux peuvent la modifier. */
  store: MemoryStore;
  /** Le moteur de rejeu (assembleur statique partagé avec l'app). */
  engine: ReplayEngine;
  /** Le moteur des actions du Cerveau, branché sur la même mémoire. */
  brain: BrainEngine;
  /** Le résultat brut du rejeu (diagnostics, plan de tickets, compteurs). */
  result: ReplayResult;
  /** La vue dérivée, rafraîchie à chaque `notify()`. */
  view: DemoRun;
  /** Horloge fixe : le lendemain du dernier build du jeu d'exemple. */
  now: Date;
  /** Écoute les changements de la vue ; rend la fonction de désabonnement. */
  subscribe(listener: () => void): () => void;
  /** Recalcule la vue depuis le magasin, puis prévient les panneaux. */
  notify(): Promise<void>;
  /** Rejoue le jeu depuis le début, dans une mémoire neuve. */
  reload(): Promise<void>;
}

/** Rejoue le jeu d'exemple dans une mémoire neuve. */
async function replay(now: Date): Promise<{
  store: MemoryStore;
  engine: ReplayEngine;
  result: ReplayResult;
}> {
  const store = new MemoryStore();
  const engine = staticReplayEngine();
  const result = await replayWithEngine(SAMPLE, engine, { store, now });
  return { store, engine, result };
}

/**
 * Construit l'atelier : un rejeu du jeu d'exemple, prêt à être exploré.
 *
 * L'horloge est figée (`demoNow`) : les chiffres ne dépendent jamais du jour
 * où un visiteur ouvre la page.
 */
export async function createWorkspace(now: Date = demoNow()): Promise<Workspace> {
  const first = await replay(now);
  const listeners = new Set<() => void>();
  const workspace: Workspace = {
    store: first.store,
    engine: first.engine,
    brain: createBrainEngine(CORE, first.store, { now: () => workspace.now }),
    result: first.result,
    view: await viewOf(first.result, first.store, now),
    now,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async notify() {
      workspace.view = await viewOf(workspace.result, workspace.store, workspace.now);
      for (const listener of listeners) listener();
    },
    async reload() {
      const next = await replay(workspace.now);
      workspace.store = next.store;
      workspace.engine = next.engine;
      workspace.result = next.result;
      workspace.brain = createBrainEngine(CORE, next.store, { now: () => workspace.now });
      await workspace.notify();
    },
  };
  return workspace;
}
