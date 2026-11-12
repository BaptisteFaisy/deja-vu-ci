/**
 * Le panneau « Sécurité », testé sans navigateur : sa logique pure
 * (`securite-demo.ts`) fait tourner le vrai code du produit.
 *
 * Couvert : le masquage (défauts + motif supplémentaire qui s'ajoute sans
 * jamais retirer), le pont signé (signature valide acceptée, six altérations
 * refusées avec la raison exacte du produit, rotation à double acceptation),
 * la minimisation (trois politiques, trois tailles, moteur ↔ Cerveau
 * concordants) et l'inventaire (le vrai SBOM du dépôt).
 */

import { describe, expect, it } from 'vitest';
import { BRIDGE_HEADERS } from '../../packages/bridge/src/index';
import {
  DEMO_SECRET,
  NEXT_SECRET,
  demoNonce,
  fakeSampleText,
  minimizationRows,
  refusalScenarios,
  rotationDemo,
  runMaskDemo,
  sampleExcerpt,
  sbomRows,
  signDemo,
  verifyDemo,
} from '../src/panels/securite-demo';

/** Horloge fixe de test (le panneau utilise celle de l'atelier). */
const NOW = new Date('2026-11-08T12:00:00Z');

describe('panneau sécurité — masquage', () => {
  it('masque les secrets de l’exemple pré-rempli (tous fictifs, construits à l’exécution)', () => {
    const demo = runMaskDemo(fakeSampleText(), '', '');
    expect(demo.base.masked).toBeGreaterThanOrEqual(5);
    for (const kind of ['token', 'aws-key', 'url-credentials', 'password', 'email']) {
      expect(demo.base.kinds, kind).toContain(kind);
    }
    expect(demo.base.text).not.toContain('AKIA');
    expect(demo.base.text).not.toContain('alice.dupont@example.com');
    expect(demo.base.text).not.toContain('deploy:');
    expect(demo.base.text).toContain('«[masqué:');
  });

  it('ajoute le motif supplémentaire sans jamais retirer les motifs par défaut', () => {
    const text = fakeSampleText();
    const demo = runMaskDemo(text, 'EMP-[0-9]{4,}', 'employee-id');
    expect(demo.withExtra).toBeDefined();
    expect(demo.base.text, 'l’identifiant interne survit aux motifs par défaut').toContain('EMP-4821');
    expect(demo.withExtra?.masked).toBe(demo.base.masked + 1);
    expect(demo.withExtra?.kinds).toContain('employee-id');
    expect(demo.withExtra?.text).not.toContain('EMP-4821');
    for (const kind of demo.base.kinds) {
      expect(demo.withExtra?.kinds, kind).toContain(kind);
    }
  });

  it('signale une expression invalide au lieu de lever', () => {
    const demo = runMaskDemo('texte quelconque', 'EMP-[0-9{', 'x');
    expect(demo.error).toBeTruthy();
    expect(demo.withExtra).toBeUndefined();
  });
});

describe('panneau sécurité — pont signé', () => {
  const request = signDemo(DEMO_SECRET, NOW);

  it('accepte la signature valide produite par le produit', () => {
    const result = verifyDemo(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({
        kind: 'ingest',
        repo: 'payments-api',
        commit: '00f1aky0000',
        step: 'gradle test',
        outcome: 'failure',
      });
    }
    expect(request.headers[BRIDGE_HEADERS.signature]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuse chaque altération avec la raison exacte du produit', () => {
    const scenarios = refusalScenarios();
    expect(scenarios).toHaveLength(6);
    for (const scenario of scenarios) {
      const result = scenario.run(request);
      expect(result.ok, scenario.id).toBe(false);
      if (!result.ok) expect(result.reason, scenario.id).toBe(scenario.expectReason);
    }
  });

  it('tire des nonces hexadécimaux uniques (32 caractères)', () => {
    expect(demoNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(demoNonce()).not.toBe(demoNonce());
  });

  it('rotation : l’ancien et le nouveau sont acceptés pendant le chevauchement', () => {
    const rotation = rotationDemo(NOW);
    expect(rotation.set.secrets[0]).toBe(NEXT_SECRET);
    expect(rotation.set.secrets).toContain(DEMO_SECRET);
    expect(rotation.oldAccepted.ok, 'ancien message, ensemble tourné').toBe(true);
    expect(rotation.newAccepted.ok, 'nouveau message, ensemble tourné').toBe(true);
    expect(rotation.oldWithoutOverlap.ok, 'hors chevauchement').toBe(false);
    if (!rotation.oldWithoutOverlap.ok) {
      expect(rotation.oldWithoutOverlap.reason).toBe('signature invalide');
    }
  });
});

describe('panneau sécurité — minimisation', () => {
  const rows = minimizationRows();

  it('produit trois tailles différentes pour le même extrait', () => {
    expect(rows.map((row) => row.policy)).toEqual(['hash-only', 'masked-snippet', 'full']);
    const sizes = rows.map((row) => row.engine.bytes);
    expect(new Set(sizes).size, 'trois politiques, trois tailles').toBe(3);
    expect(sizes[0]).toBe(0);
    expect(sizes[1]).toBeGreaterThan(0);
    expect(sizes[1]).toBeLessThan(sizes[2]);
  });

  it('garde la même empreinte sous toutes les politiques', () => {
    expect(new Set(rows.map((row) => row.engine.fingerprint)).size).toBe(1);
    expect(rows[0].engine.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(rows[0].engine.text).toBeUndefined();
  });

  it('moteur et Cerveau concordent, politique par politique', () => {
    for (const row of rows) {
      expect(row.agree, row.policy).toBe(true);
      expect(row.brain.bytes, row.policy).toBe(row.engine.bytes);
    }
  });

  it('minimise un extrait réel plus long que le budget d’un snippet', () => {
    expect(sampleExcerpt().length).toBeGreaterThan(512);
    const snippet = rows[1];
    expect(snippet.engine.truncated).toBe(true);
    expect(snippet.engine.text?.length).toBe(512);
  });
});

describe('panneau sécurité — inventaire', () => {
  const rows = sbomRows();

  it('lit le vrai SBOM : internes MIT, tiers sans licence inventée', () => {
    expect(rows.length).toBeGreaterThan(5);
    const core = rows.find((row) => row.name === '@dejavu/core');
    expect(core?.firstParty).toBe(true);
    expect(core?.licenses).toBe('MIT');
    const forge = rows.find((row) => row.name === '@forge/api');
    expect(forge?.firstParty).toBe(false);
    expect(forge?.licenses, 'aucune licence inventée').toBe('');
  });
});
