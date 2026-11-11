/**
 * Validation des entrées des actions (§ 13).
 *
 * Une entrée invalide est refusée par une erreur lisible, jamais par une
 * exception : un agent qui appelle une action avec un champ manquant doit
 * pouvoir corriger son appel.
 */

/** Résultat de la validation d'un champ texte. */
export type FieldResult = { ok: true; value: string } | { ok: false; error: string };

/** Longueur maximale d'un champ texte libre (borne la charge utile). */
export const MAX_TEXT_LENGTH = 4000;

/** Longueur maximale d'un identifiant. */
export const MAX_ID_LENGTH = 200;

/** Valide un champ texte obligatoire. */
export function requireText(value: unknown, field: string, max = MAX_TEXT_LENGTH): FieldResult {
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: `${field} must not be empty` };
  if (trimmed.length > max) return { ok: false, error: `${field} is longer than ${max} characters` };
  return { ok: true, value: trimmed };
}

/** Valide un champ texte facultatif (rend `undefined` s'il est absent). */
export function optionalText(value: unknown, field: string, max = MAX_TEXT_LENGTH): FieldResult {
  if (value === undefined || value === null) return { ok: true, value: '' };
  return requireText(value, field, max);
}

/** Valide un entier positif ou nul. */
export function optionalCount(value: unknown, field: string, max = 365): FieldResult {
  if (value === undefined || value === null) return { ok: true, value: '' };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false, error: `${field} must be a positive integer` };
  }
  if (parsed > max) return { ok: false, error: `${field} must be lower than or equal to ${max}` };
  return { ok: true, value: String(parsed) };
}

/** Valide un booléen ; `undefined` vaut `false`. */
export function requireBoolean(value: unknown, field: string): { ok: true; value: boolean } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: false };
  if (typeof value === 'boolean') return { ok: true, value };
  if (value === 'true') return { ok: true, value: true };
  if (value === 'false') return { ok: true, value: false };
  return { ok: false, error: `${field} must be a boolean` };
}
