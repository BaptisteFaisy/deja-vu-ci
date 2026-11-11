/**
 * Proximité entre un extrait d'erreur et une signature mémorisée.
 *
 * `search-failures` accepte un texte libre : l'extrait est signé comme une
 * erreur (même fonction du moteur que le Capteur), puis rapproché des
 * signatures connues. Trois niveaux de rapprochement sont distingués :
 *   - `exact`  : même signature (catégorie + type + message + pile) ;
 *   - `family` : même famille (catégorie + type + message) ;
 *   - `near`   : message proche, mesuré par le coefficient de Dice sur les
 *                mots des messages normalisés.
 *
 * Aucun calcul parallèle au moteur : le score ne sert qu'à ordonner des
 * candidats déjà signés par le moteur.
 */

/** Mots retenus pour comparer deux messages (hors mots vides de sens). */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'was', 'are', 'has',
  'have', 'not', 'but', 'you', 'your', 'its', 'les', 'des', 'une', 'dans',
  'pour', 'avec', 'est', 'sur', 'pas', 'sur',
]);

/** Découpe un message normalisé en mots comparables. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Coefficient de Dice entre deux ensembles de mots (0..1). */
export function diceCoefficient(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let shared = 0;
  for (const word of new Set(left)) if (rightSet.has(word)) shared += 1;
  return (2 * shared) / (new Set(left).size + rightSet.size);
}

/** Proximité entre deux messages (0..1). */
export function messageSimilarity(left: string, right: string): number {
  return diceCoefficient(tokenize(left), tokenize(right));
}

/** Niveau de rapprochement d'un candidat. */
export type MatchKind = 'exact' | 'family' | 'near';

/** Score d'un candidat : plus il est proche, plus le score est haut. */
export function scoreMatch(kind: MatchKind, similarity: number): number {
  if (kind === 'exact') return 1;
  if (kind === 'family') return 0.8;
  return Math.round(similarity * 100) / 100;
}
