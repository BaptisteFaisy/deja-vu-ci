/**
 * Tests des six actions du § 13.
 *
 * Le magasin injecté est une doublure mémoire locale (`test/fakes/`) : les
 * tests ne touchent ni au réseau, ni à la base Forge SQL.
 */

import { describe, expect, it } from 'vitest';
import * as actions from '../src/actions/index.js';
import { runExplainBuildFailure } from '../src/actions/explain-build-failure.js';
import { runGetSignature } from '../src/actions/get-signature.js';
import { runListFlakyTests } from '../src/actions/list-flaky-tests.js';
import { runReportResolution } from '../src/actions/report-resolution.js';
import { runConfirmResolution } from '../src/actions/confirm-resolution.js';
import { runSearchFailures } from '../src/actions/search-failures.js';
import { diagnoseFor } from '../src/actions/context.js';
import { makeFakeEngine } from './fakes/engine.js';
import {
  EXACT_SIGNATURE,
  FAMILY_VARIANT_SIGNATURE,
  FLAKY_OCCURRENCES,
  FLAKY_SIGNATURE,
  NEW_SIGNATURE,
  RESOLUTION,
  RESOLVED_SIGNATURE,
  SEED,
  SEED_TWO_FLAKY,
} from './fakes/fixtures.js';

describe('actions du Cerveau (§ 13)', () => {
  it('expose exactement les six actions du contrat', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'confirm-resolution',
      'explain-build-failure',
      'get-signature',
      'list-flaky-tests',
      'report-resolution',
      'search-failures',
    ]);
  });

  it('donne à chaque action son nom, son verbe et son schéma', () => {
    const verbs = Object.values(actions).map((action) => action.verb);
    expect(verbs).toContain('GET');
    expect(verbs).toContain('CREATE');
    expect(verbs).toContain('UPDATE');
    for (const action of Object.values(actions)) {
      expect(action.key).toMatch(/^[a-z-]+$/);
      expect(action.description.length).toBeGreaterThan(10);
    }
  });
});

describe('explain-build-failure', () => {
  it('rend le diagnostic du moteur pour une clé de ticket', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runExplainBuildFailure(engine, { issueKey: 'PAY-88' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.diagnoseCalls).toHaveLength(1);
    expect(result.data.diagnostic.signatureId).toBe(FLAKY_SIGNATURE.id);
    expect(result.data.confidence).toBe(result.data.diagnostic.confidence);
    expect(result.data.justification.length).toBeGreaterThan(0);
  });

  it('rend exactement le diagnostic que rend la carte de PR', async () => {
    // La carte de PR (lot F) et l'action appellent la même fonction du moteur
    // avec le même contexte : les deux résultats doivent être identiques.
    const engine = makeFakeEngine(SEED);
    const viaAction = await runExplainBuildFailure(engine, { issueKey: 'PAY-88' });
    const viaCard = await diagnoseFor(
      engine,
      FLAKY_OCCURRENCES[FLAKY_OCCURRENCES.length - 1],
    );
    expect(viaAction.ok).toBe(true);
    if (!viaAction.ok) return;
    expect(viaAction.data.diagnostic).toEqual(viaCard);
    expect(viaAction.data.diagnostic.kind).toBe(viaCard.kind);
    expect(viaAction.data.diagnostic.confidence).toBe(viaCard.confidence);
  });

  it('appelle la fonction du moteur, pas un calcul parallèle', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runExplainBuildFailure(engine, { buildUrl: FLAKY_OCCURRENCES[0].buildUrl });
    expect(result.ok).toBe(true);
    expect(engine.diagnoseCalls).toHaveLength(1);
    expect(engine.diagnoseCalls[0].occurrence.id).toBe('occ-1');
  });

  it('refuse un appel sans clé ni URL', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runExplainBuildFailure(engine, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('issueKey or buildUrl');
  });

  it('refuse une entrée qui n\'est pas une chaîne', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runExplainBuildFailure(engine, { issueKey: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('issueKey');
  });

  it('répond par une erreur explicite quand rien ne correspond', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runExplainBuildFailure(engine, { issueKey: 'PAY-999' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('no known failure');
  });
});

describe('search-failures', () => {
  it('retrouve une signature à partir d\'un extrait libre', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runSearchFailures(engine, { text: 'expected true to be false' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matches.length).toBeGreaterThan(0);
    expect(result.data.matches[0].signatureId).toBe(FLAKY_SIGNATURE.id);
    expect(result.data.matches[0].score).toBeGreaterThan(0);
  });

  it('trouve la signature exacte puis la variante de famille', async () => {
    const engine = makeFakeEngine({
      signatures: [EXACT_SIGNATURE, FAMILY_VARIANT_SIGNATURE],
      occurrences: [],
    });
    const result = await runSearchFailures(engine, { text: 'expected true to be false' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.data.matches.map((m) => `${m.signatureId}:${m.match}`);
    expect(kinds).toContain(`${EXACT_SIGNATURE.id}:exact`);
    expect(kinds).toContain(`${FAMILY_VARIANT_SIGNATURE.id}:family`);
    const exact = result.data.matches.find((m) => m.signatureId === EXACT_SIGNATURE.id);
    const family = result.data.matches.find((m) => m.signatureId === FAMILY_VARIANT_SIGNATURE.id);
    expect(exact?.score).toBeGreaterThan(family?.score ?? 1);
  });

  it('filtre par dépôt', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runSearchFailures(engine, {
      text: 'expected true to be false',
      repository: 'other-repo',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matches).toHaveLength(0);
  });

  it('refuse un texte vide', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runSearchFailures(engine, { text: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('text');
  });
});

describe('get-signature', () => {
  it('rend l\'historique, le statut et le ticket', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runGetSignature(engine, { signatureId: FLAKY_SIGNATURE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('flaky');
    expect(result.data.issueKey).toBe('PAY-88');
    expect(result.data.history).toHaveLength(3);
    expect(result.data.history[0].occurredAt >= result.data.history[1].occurredAt).toBe(true);
  });

  it('rend la résolution d\'une signature résolue', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runGetSignature(engine, { signatureId: RESOLVED_SIGNATURE.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.resolution?.commit).toBe(RESOLUTION.commit);
    expect(result.data.resolution?.confirmedBy).toBe('marie');
  });

  it('refuse une signature inconnue', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runGetSignature(engine, { signatureId: 'nope' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unknown signature');
  });
});

describe('list-flaky-tests', () => {
  it('classe les tests instables par coût décroissant', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runListFlakyTests(engine, { repository: 'web', days: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tests).toHaveLength(1);
    expect(result.data.tests[0].testName).toBe('check.limiter');
    expect(result.data.tests[0].ciMinutesLost).toBeGreaterThan(0);
    expect(result.data.windowDays).toBe(14);
  });

  it('classe par coût décroissant quand plusieurs tests sont instables', async () => {
    const engine = makeFakeEngine(SEED_TWO_FLAKY);
    const result = await runListFlakyTests(engine, { repository: 'web', days: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tests).toHaveLength(2);
    expect(result.data.tests[0].signatureId).toBe(FLAKY_SIGNATURE.id);
    expect(result.data.tests[0].ciMinutesLost).toBeGreaterThan(result.data.tests[1].ciMinutesLost);
  });

  it('ne renvoie pas les tests stables', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runListFlakyTests(engine, { repository: 'web', days: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.tests.map((t) => t.signatureId);
    expect(ids).not.toContain(NEW_SIGNATURE.id);
  });

  it('refuse un nombre de jours négatif', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runListFlakyTests(engine, { days: -3 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('days');
  });
});

describe('report-resolution', () => {
  it('enregistre une résolution candidate, encore non confirmée', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runReportResolution(engine, {
      signatureId: FLAKY_SIGNATURE.id,
      commit: 'deadbeefcafe',
      note: 'retry with a bigger pool',
      author: 'luc',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmed).toBe(false);
    expect(result.data.resolution.commit).toBe('deadbeefcafe');
    expect(result.data.resolution.confidence).toBeLessThan(0.6);
    const stored = await engine.store.getResolution(FLAKY_SIGNATURE.id);
    expect(stored?.commit).toBe('deadbeefcafe');
  });

  it('refuse une signature inconnue', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runReportResolution(engine, { signatureId: 'nope', commit: 'abc' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unknown signature');
  });

  it('refuse un commit vide', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runReportResolution(engine, { signatureId: FLAKY_SIGNATURE.id, commit: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('commit');
  });
});

describe('confirm-resolution', () => {
  it('confirme une résolution candidate', async () => {
    const engine = makeFakeEngine(SEED);
    const reported = await runReportResolution(engine, {
      signatureId: FLAKY_SIGNATURE.id,
      commit: 'deadbeefcafe',
    });
    expect(reported.ok).toBe(true);
    const result = await runConfirmResolution(engine, {
      signatureId: FLAKY_SIGNATURE.id,
      confirmed: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmed).toBe(true);
    expect(result.data.resolution.confidence).toBe(1);
    expect(result.data.resolution.confirmedBy).toBe('human');
  });

  it('rejette une résolution et la laisse non confirmée', async () => {
    const engine = makeFakeEngine(SEED);
    await runReportResolution(engine, { signatureId: FLAKY_SIGNATURE.id, commit: 'deadbeefcafe' });
    const result = await runConfirmResolution(engine, {
      signatureId: FLAKY_SIGNATURE.id,
      confirmed: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.confirmed).toBe(false);
    expect(result.data.resolution.confirmedAt).toBeUndefined();
  });

  it('refuse de confirmer quand aucune résolution n\'existe', async () => {
    const engine = makeFakeEngine(SEED);
    const result = await runConfirmResolution(engine, {
      signatureId: FLAKY_SIGNATURE.id,
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('no resolution recorded');
  });
});
