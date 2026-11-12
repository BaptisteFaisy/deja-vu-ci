/**
 * La console Rovo, hors DOM : les six actions du contrat, le formulaire généré
 * depuis le schéma, les gardes réelles, et les écritures dans la mémoire de la
 * page. Tout est exécuté avec le vrai moteur d'actions du Cerveau, branché sur
 * le vrai rejeu du jeu d'exemple — aucun double, aucun réseau.
 */

import { describe, expect, it } from 'vitest';
import { diagnosticLabel, statusLabel } from '@dejavu/present';
import { createWorkspace } from '../src/state/workspace';
import {
  coerceArgs,
  fieldSpecs,
  humanRead,
  inputsLine,
  listActions,
  suggestArgs,
  type RovoAction,
} from '../src/panels/rovo-console';
import type { InputSchema } from '../../../apps/brain/src/actions/descriptor';

/** L'action du contrat voulue, ou échec explicite du test. */
function action(key: string): RovoAction {
  const found = listActions().find((candidate) => candidate.key === key);
  if (!found) throw new Error(`action introuvable : ${key}`);
  return found;
}

describe('console Rovo — les descripteurs comme source de vérité', () => {
  it('expose exactement les six actions du contrat', () => {
    expect(listActions().map((entry) => entry.key).sort()).toEqual([
      'confirm-resolution',
      'explain-build-failure',
      'get-signature',
      'list-flaky-tests',
      'report-resolution',
      'search-failures',
    ]);
  });

  it('porte sur chaque descripteur un verbe, une description et un schéma', () => {
    for (const entry of listActions()) {
      expect(['GET', 'CREATE', 'UPDATE']).toContain(entry.verb);
      expect(entry.description.length).toBeGreaterThan(10);
      expect(fieldSpecs(entry.inputs).length).toBeGreaterThan(0);
    }
  });

  it('génère les champs depuis le schéma (type, obligation, description)', () => {
    const specs = fieldSpecs(action('search-failures').inputs);
    expect(specs.map((spec) => spec.name)).toEqual(['text', 'repository']);
    expect(specs[0].required).toBe(true);
    expect(specs[0].type).toBe('string');
    expect(specs[1].required).toBe(false);
    const confirmed = fieldSpecs(action('confirm-resolution').inputs);
    expect(confirmed.map((spec) => spec.type)).toEqual(['string', 'boolean']);
    expect(inputsLine(action('get-signature').inputs)).toBe('signatureId: string (required)');
  });

  it('convertit le formulaire en arguments typés, et omet les champs vides', () => {
    const schema: InputSchema = {
      days: { type: 'integer', description: '' },
      confirmed: { type: 'boolean', description: '' },
      note: { type: 'string', description: '' },
    };
    expect(coerceArgs(schema, { days: '14', confirmed: 'true', note: '  ' })).toEqual({
      days: 14,
      confirmed: true,
    });
    expect(coerceArgs(schema, {})).toEqual({});
  });
});

describe('console Rovo — gardes réelles, jamais une exception', () => {
  it('répond { ok: false, error } quand un paramètre obligatoire manque', async () => {
    const workspace = await createWorkspace();
    const result = await action('get-signature')(workspace.brain, {});
    expect(result).toEqual({ ok: false, error: 'signatureId must be a string' });
    const read = humanRead('get-signature', result, 'en');
    expect(read.facts[0].value).toBe('signatureId must be a string');
    expect(read.facts[0].tone).toBe('red');
  });

  it('répond une erreur réelle sur un paramètre invalide', async () => {
    const workspace = await createWorkspace();
    const id = workspace.view.signatures[0].id;
    const invalid = await action('confirm-resolution')(workspace.brain, {
      signatureId: id,
      confirmed: 'maybe',
    });
    expect(invalid).toEqual({ ok: false, error: 'confirmed must be a boolean' });
    const unknown = await action('get-signature')(workspace.brain, { signatureId: 'nope' });
    expect(unknown).toEqual({ ok: false, error: 'unknown signature: nope' });
  });
});

describe('console Rovo — les six actions exécutées sur la mémoire de la page', () => {
  it('pré-remplit les champs avec de vraies valeurs du rejeu', async () => {
    const workspace = await createWorkspace();
    const args = suggestArgs(workspace.view);
    expect(args.signatureId).toBe(workspace.view.signatures[0].id);
    expect(args.issueKey.length).toBeGreaterThan(0);
    expect(args.buildUrl).toContain('https://');
    expect(args.text.length).toBeGreaterThan(50);
    expect(args.commit.length).toBeGreaterThan(0);
  });

  it('explain-build-failure rend le diagnostic réel, libellé par @dejavu/present', async () => {
    const workspace = await createWorkspace();
    const args = suggestArgs(workspace.view);
    const result = await action('explain-build-failure')(workspace.brain, {
      issueKey: args.issueKey,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { diagnostic: { kind: 'flaky' }; confidence: number };
    const read = humanRead('explain-build-failure', result, 'en');
    expect(read.facts[0].value).toBe(diagnosticLabel(data.diagnostic.kind, 'en'));
    expect(read.facts[1].value).toBe(`${Math.round(data.confidence * 100)}%`);
    expect(read.tables[0].rows.length).toBeGreaterThan(0);
  });

  it('search-failures rapproche un vrai journal d’erreur du jeu d’exemple', async () => {
    const workspace = await createWorkspace();
    const args = suggestArgs(workspace.view);
    const result = await action('search-failures')(workspace.brain, { text: args.text });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { matches: unknown[]; examined: number };
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.examined).toBe(workspace.view.signatures.length);
    const read = humanRead('search-failures', result, 'fr');
    expect(read.tables[0].rows.length).toBe(data.matches.length);
  });

  it('get-signature rend l’histoire réelle d’une signature du rejeu', async () => {
    const workspace = await createWorkspace();
    const args = suggestArgs(workspace.view);
    const result = await action('get-signature')(workspace.brain, {
      signatureId: args.signatureId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { signature: { id: string }; history: unknown[]; status: 'new' };
    expect(data.signature.id).toBe(args.signatureId);
    expect(data.history.length).toBeGreaterThan(0);
    const read = humanRead('get-signature', result, 'fr');
    expect(read.facts[1].value).toBe(statusLabel(data.status, 'fr'));
  });

  it('list-flaky-tests accepte l’appel vide (tout est facultatif) et classe par coût', async () => {
    const workspace = await createWorkspace();
    const result = await action('list-flaky-tests')(workspace.brain, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { tests: Array<{ ciMinutesLost: number }>; windowDays: number };
    expect(data.windowDays).toBe(14);
    for (let index = 1; index < data.tests.length; index += 1) {
      expect(data.tests[index - 1].ciMinutesLost).toBeGreaterThanOrEqual(
        data.tests[index].ciMinutesLost,
      );
    }
  });
});

describe('console Rovo — les écritures restent dans la mémoire de la page', () => {
  it('report puis confirm écrivent vraiment dans le magasin partagé', async () => {
    const workspace = await createWorkspace();
    const args = suggestArgs(workspace.view);
    const reported = await action('report-resolution')(workspace.brain, {
      signatureId: args.signatureId,
      commit: args.commit,
      author: args.author,
      note: args.note,
    });
    expect(reported.ok).toBe(true);
    const before = await workspace.store.getResolution(args.signatureId);
    expect(before?.confirmedAt).toBeUndefined();
    expect(before?.confidence).toBe(0.5);

    const confirmed = await action('confirm-resolution')(workspace.brain, {
      signatureId: args.signatureId,
      confirmed: true,
    });
    expect(confirmed.ok).toBe(true);
    const after = await workspace.store.getResolution(args.signatureId);
    expect(after?.confirmedAt).toBeTruthy();
    expect(after?.confidence).toBe(1);

    await workspace.notify();
    const read = humanRead('confirm-resolution', confirmed, 'en');
    expect(read.facts.some((fact) => fact.value === 'Yes')).toBe(true);
  });

  it('refuse une résolution déjà confirmée — la garde réelle du Cerveau', async () => {
    const workspace = await createWorkspace();
    const args = suggestArgs(workspace.view);
    await action('report-resolution')(workspace.brain, {
      signatureId: args.signatureId,
      commit: args.commit,
    });
    await action('confirm-resolution')(workspace.brain, {
      signatureId: args.signatureId,
      confirmed: true,
    });
    const again = await action('report-resolution')(workspace.brain, {
      signatureId: args.signatureId,
      commit: 'ffffffffffffffff',
    });
    expect(again).toEqual({
      ok: false,
      error: 'this signature already has a confirmed resolution',
    });
  });
});
