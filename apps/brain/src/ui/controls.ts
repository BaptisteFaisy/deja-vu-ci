/**
 * Shared helpers for the radio-group controls of the curation (CI-17) and
 * quarantine (CI-19) panels. Pure: no JSX, no `@forge/react`, no network —
 * both panels import these so nothing is duplicated.
 */

import type { Signature } from '@dejavu/core';

/** One `{label, value}` option of a radio group. */
export interface Option {
  label: string;
  value: string;
}

/** Reads the selected value out of a radio change event (target is a DOM node). */
export function valueOf(event: { target: unknown }): string {
  const target = event.target as { value?: string } | null;
  return target?.value ?? '';
}

/** One error message, whatever was thrown (shared by the panels' `invoke` calls). */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Builds the signature options of a radio group: short id, then the template. */
export function signatureOptions(
  signatures: Signature[],
  shortId: (id: string) => string,
): Option[] {
  return signatures.map((signature) => ({
    label: `${shortId(signature.id)} — ${signature.template.slice(0, 48)}`,
    value: signature.id,
  }));
}
