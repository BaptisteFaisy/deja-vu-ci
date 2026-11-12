/**
 * Le panneau « Preuves » ne ment jamais : chaque extracteur est testé sur des
 * entrées fictives (en mémoire, aucun fichier), puis sur les vrais fichiers
 * JSON du dépôt — s'ils changent de forme, le panneau affiche « non disponible »
 * et ce test casse avant. La liste des contrôles du doctor est comparée au
 * catalogue réel de `tools/doctor.mjs` : aucune invention, aucune dérive.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DOCTOR_CHECKS,
  readCostSnapshot,
  readDiagnosticSpread,
  readGoldenMeta,
  readSbom,
  readTicketPlan,
} from '../src/panels/preuves-donnees';
import { t } from '../src/lib/i18n';
// Charger le panneau enregistre ses chaînes de traduction (aucun DOM au chargement).
import '../src/panels/preuves';
import goldenCost from '../../data/golden/cost.json';
import goldenDiagnostics from '../../data/golden/diagnostics.json';
import goldenMeta from '../../data/golden/meta.json';
import goldenTickets from '../../data/golden/tickets.json';
import sbom from '../../docs/SBOM.json';

/** Un `meta.json` fictif, conforme. */
const META_FICTIVE = {
  goldenVersion: 1,
  generator: 'tools/gen/golden.mjs',
  dataset: 'fiction-ci',
  datasetSha256: 'ab'.repeat(32),
  referenceNow: '2026-11-01T08:00:00.000Z',
  failures: 3,
  signatures: 2,
  diagnostics: 3,
  tickets: 1,
};

/** Un `byKind` fictif, conforme (les cinq diagnostics du produit). */
const BY_KIND_FICTIF = { flaky: 1, 'already-fixed': 0, new: 2, infrastructure: 0, uncertain: 0 };

describe('readGoldenMeta', () => {
  it('extrait une métadonnée conforme', () => {
    const meta = readGoldenMeta(META_FICTIVE);
    expect(meta).not.toBeNull();
    expect(meta?.dataset).toBe('fiction-ci');
    expect(meta?.failures).toBe(3);
  });

  it('refuse ce qui n’a pas la forme attendue', () => {
    expect(readGoldenMeta(null)).toBeNull();
    expect(readGoldenMeta([])).toBeNull();
    expect(readGoldenMeta('meta')).toBeNull();
    const { datasetSha256: _sha, ...sansSha } = META_FICTIVE;
    expect(readGoldenMeta(sansSha)).toBeNull();
    expect(readGoldenMeta({ ...META_FICTIVE, datasetSha256: 'court' })).toBeNull();
    expect(readGoldenMeta({ ...META_FICTIVE, referenceNow: 'hier' })).toBeNull();
    expect(readGoldenMeta({ ...META_FICTIVE, failures: -1 })).toBeNull();
    expect(readGoldenMeta({ ...META_FICTIVE, generator: 42 })).toBeNull();
  });
});

describe('readCostSnapshot', () => {
  it('extrait les cinq compteurs', () => {
    const cost = readCostSnapshot({
      windowDays: 30,
      redBuilds: 4,
      ciMinutesLost: 1.5,
      peopleAffected: 2,
      retries: 1,
    });
    expect(cost).toEqual({ windowDays: 30, redBuilds: 4, ciMinutesLost: 1.5, peopleAffected: 2, retries: 1 });
  });

  it('refuse un compteur manquant, négatif ou non numérique', () => {
    expect(readCostSnapshot({ windowDays: 30 })).toBeNull();
    expect(readCostSnapshot({ windowDays: 30, redBuilds: -1, ciMinutesLost: 0, peopleAffected: 0, retries: 0 })).toBeNull();
    expect(readCostSnapshot({ windowDays: '30', redBuilds: 1, ciMinutesLost: 1, peopleAffected: 1, retries: 1 })).toBeNull();
    expect(readCostSnapshot(undefined)).toBeNull();
  });
});

describe('readDiagnosticSpread', () => {
  it('rend les cinq diagnostics, dans l’ordre du produit', () => {
    const spread = readDiagnosticSpread({ byKind: BY_KIND_FICTIF });
    expect(spread?.map(([kind]) => kind)).toEqual([
      'flaky',
      'already-fixed',
      'new',
      'infrastructure',
      'uncertain',
    ]);
    expect(spread?.find(([kind]) => kind === 'new')?.[1]).toBe(2);
  });

  it('refuse une clé inconnue, une valeur non entière ou un byKind absent', () => {
    expect(readDiagnosticSpread({ byKind: { ...BY_KIND_FICTIF, mystere: 1 } })).toBeNull();
    expect(readDiagnosticSpread({ byKind: { ...BY_KIND_FICTIF, flaky: 1.5 } })).toBeNull();
    expect(readDiagnosticSpread({ byKind: { flaky: 1 } })).toBeNull();
    expect(readDiagnosticSpread({})).toBeNull();
    expect(readDiagnosticSpread('byKind')).toBeNull();
  });
});

describe('readTicketPlan', () => {
  it('compte les actions par type', () => {
    const plan = readTicketPlan([
      { kind: 'create' },
      { kind: 'comment' },
      { kind: 'comment' },
      { kind: 'update' },
    ]);
    expect(plan).toEqual({ create: 1, update: 1, comment: 2, total: 4 });
  });

  it('accepte un plan vide et refuse toute autre forme', () => {
    expect(readTicketPlan([])).toEqual({ create: 0, update: 0, comment: 0, total: 0 });
    expect(readTicketPlan([{ kind: 'delete' }])).toBeNull();
    expect(readTicketPlan([{ kind: 'create' }, null])).toBeNull();
    expect(readTicketPlan({ kind: 'create' })).toBeNull();
  });
});

describe('readSbom', () => {
  it('sépare les paquets maison des dépendances tierces', () => {
    const summary = readSbom({
      specVersion: '1.5',
      components: [
        { name: '@dejavu/core', version: '0.1.0', properties: [{ name: 'dejavu:first-party', value: 'true' }] },
        { name: '@forge/api', version: '^7.2.2' },
      ],
    });
    expect(summary?.specVersion).toBe('1.5');
    expect(summary?.firstParty).toEqual(['@dejavu/core']);
    expect(summary?.thirdParty).toEqual([{ name: '@forge/api', version: '^7.2.2' }]);
  });

  it('refuse un composant sans nom, sans version, ou un SBOM sans components', () => {
    expect(readSbom({ specVersion: '1.5', components: [{ version: '1' }] })).toBeNull();
    expect(readSbom({ specVersion: '1.5', components: [{ name: 'x' }] })).toBeNull();
    expect(readSbom({ components: [] })).toBeNull();
    expect(readSbom({ specVersion: '1.5' })).toBeNull();
    expect(readSbom(7)).toBeNull();
  });
});

describe('les vrais fichiers du dépôt passent les extracteurs', () => {
  it('meta.json, cost.json, diagnostics.json, tickets.json et SBOM.json sont lisibles', () => {
    expect(readGoldenMeta(goldenMeta)).not.toBeNull();
    expect(readCostSnapshot(goldenCost)).not.toBeNull();
    expect(readDiagnosticSpread(goldenDiagnostics)).not.toBeNull();
    expect(readTicketPlan(goldenTickets)).not.toBeNull();
    expect(readSbom(sbom)).not.toBeNull();
  });

  it('les fichiers golden sont cohérents entre eux (même rejeu)', () => {
    const meta = readGoldenMeta(goldenMeta);
    const spread = readDiagnosticSpread(goldenDiagnostics);
    const plan = readTicketPlan(goldenTickets);
    const cost = readCostSnapshot(goldenCost);
    expect(spread?.reduce((sum, [, count]) => sum + count, 0)).toBe(meta?.diagnostics);
    expect(plan?.total).toBe(meta?.tickets);
    expect(cost?.redBuilds).toBe(meta?.failures);
    const summary = readSbom(sbom);
    expect(summary?.firstParty.length).toBeGreaterThan(0);
    expect(summary?.thirdParty.length).toBeGreaterThan(0);
  });
});

describe('le catalogue du doctor vient du fichier, pas d’une invention', () => {
  /** Les noms du catalogue `CHECKS` de tools/doctor.mjs, lus à l’exécution. */
  function nomsReels(): string[] {
    const source = readFileSync(fileURLToPath(new URL('../../tools/doctor.mjs', import.meta.url)), 'utf8');
    const bloc = source.slice(source.indexOf('const CHECKS = ['), source.indexOf('];', source.indexOf('const CHECKS = [')));
    return [...bloc.matchAll(/name:\s*'([a-z0-9-]+)'/g)].map((match) => match[1]);
  }

  it('liste exactement les contrôles de tools/doctor.mjs', () => {
    expect([...DOCTOR_CHECKS]).toEqual(nomsReels());
  });

  it('traduit chaque contrôle dans les deux langues', () => {
    for (const name of DOCTOR_CHECKS) {
      for (const lang of ['en', 'fr'] as const) {
        const label = t(`preuves.check.${name}`, lang);
        expect(label, `${name}/${lang}`).not.toBe(`preuves.check.${name}`);
        expect(label.length, `${name}/${lang}`).toBeGreaterThan(3);
      }
    }
  });
});
