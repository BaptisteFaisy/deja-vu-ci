/**
 * Assemblage **statique** du moteur de rejeu — une seule implémentation, partagée.
 *
 * `loadEngine()` (dans `replay.js`) charge les six modules frères par import
 * dynamique : c'est ce qui prouve, à l'exécution, que chaque brique du moteur
 * est réellement séparable. Cet import dynamique est impossible dans un bundle
 * — le bundler Forge (webpack) comme esbuild ne résolvent pas un spécificateur
 * variable — d'où cet assembleur statique, qui renvoie exactement le même
 * `ReplayEngine` à partir des fonctions réelles du paquet.
 *
 * Deux consommateurs, et pas de troisième copie :
 *  - `apps/brain/src/seed.ts` — le bouton « Rejouer le jeu d'exemple » (§ 22) ;
 *  - `site/src/lib/demo.ts` — la démo publique, qui fait tourner le moteur dans
 *    le navigateur (GitHub Pages).
 */

import { assessFlakiness } from './flaky.js';
import { diagnose } from './diagnose.js';
import { extractErrorBlocks } from './extract.js';
import { familyOf, signatureOf } from './sign.js';
import { inferCandidateResolution } from './resolutions.js';
import { planTicketActions } from './tickets.js';
import type { ReplayEngine } from './replay.js';

/**
 * Le moteur de rejeu assemblé statiquement, à partir des vraies fonctions.
 *
 * Aucune logique propre : chaque partie est la fonction du paquet, telle que
 * `loadEngine()` la chargerait. `assertEngine()` (replay.js) la valide.
 */
export function staticReplayEngine(): ReplayEngine {
  return {
    extraction: { extractErrorBlocks },
    signing: { signatureOf, familyOf },
    diagnosis: { diagnose },
    flakiness: { assessFlakiness },
    tickets: { planTicketActions },
    resolutions: { inferCandidateResolution },
  };
}
