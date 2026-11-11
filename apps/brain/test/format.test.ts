/**
 * Tests de la mise en forme des écrans (`src/ui/format.ts`).
 *
 * Module pur : aucun import `@forge/react`, aucun accès réseau.
 */

import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  filterSignatureRows,
  formatDate,
  formatMinutes,
  shortCommit,
  sortSignatureRows,
  statusBadge,
  toCostRows,
  toOccurrenceRows,
  toSignatureRows,
  type SignatureRow,
} from '../src/ui/format.js';
import { FLAKY_OCCURRENCES, FLAKY_SIGNATURE, NEW_SIGNATURE } from './fakes/fixtures.js';
import type { CostReport, Signature } from '@dejavu/core';

const shortId = (id: string): string => `S-${id.slice(-3)}`;

/** Trois signatures de test. */
const SIGNATURES: Signature[] = [FLAKY_SIGNATURE, NEW_SIGNATURE, { ...FLAKY_SIGNATURE, id: 'dddddddddddddddd', status: 'resolved', occurrences: 1 }];

describe('statuts et catégories', () => {
  it('traduit un statut avec sa couleur', () => {
    expect(statusBadge('flaky', 'en')).toEqual({ label: 'Flaky', tone: 'yellow', attention: true });
    expect(statusBadge('flaky', 'fr')).toEqual({ label: 'Instable', tone: 'yellow', attention: true });
    expect(statusBadge('resolved', 'en').tone).toBe('green');
    expect(statusBadge('regression', 'fr').attention).toBe(true);
    expect(statusBadge('known', 'en').attention).toBe(false);
  });

  it('traduit une catégorie', () => {
    expect(categoryLabel('dependency', 'en')).toBe('Dependency');
    expect(categoryLabel('dependency', 'fr')).toBe('Dépendance');
    expect(categoryLabel('unknown', 'fr')).toBe('Inconnue');
  });
});

describe('tableau des signatures', () => {
  it('prépare les lignes', () => {
    const rows = toSignatureRows(SIGNATURES, shortId, 'fr');
    expect(rows).toHaveLength(3);
    expect(rows[0].badge.label).toBe('Instable');
    expect(rows[0].issueKey).toBe('PAY-88');
    expect(rows[0].shortId).toBe('S-aaa');
  });

  it('filtre par statut, par catégorie et par texte', () => {
    const rows = toSignatureRows(SIGNATURES, shortId, 'en');
    expect(filterSignatureRows(rows, { status: 'flaky' })).toHaveLength(1);
    expect(filterSignatureRows(rows, { category: 'dependency' })).toHaveLength(0);
    const found = filterSignatureRows(rows, { text: 'connection refused' });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(NEW_SIGNATURE.id);
  });

  it('filtre par une recherche insensible à la casse', () => {
    const rows = toSignatureRows(SIGNATURES, shortId, 'en');
    expect(filterSignatureRows(rows, { text: 'EXPECTED TRUE' })).toHaveLength(2);
  });

  it('trie par dernière vue et par occurrences', () => {
    const rows = toSignatureRows(SIGNATURES, shortId, 'en');
    const byLastSeen = sortSignatureRows(rows, 'lastSeen');
    expect(byLastSeen[0].id).toBe(NEW_SIGNATURE.id);
    const byOccurrences = sortSignatureRows(rows, 'occurrences');
    expect(byOccurrences[0].occurrences).toBe(4);
  });
});

describe('occurrences et coût', () => {
  it('met les occurrences de la plus récente à la plus ancienne', () => {
    const rows = toOccurrenceRows(FLAKY_OCCURRENCES);
    expect(rows).toHaveLength(3);
    expect(rows[0].occurredAt > rows[2].occurredAt).toBe(true);
    expect(rows[0].repo).toBe('web');
  });

  it('prépare les lignes de coût', () => {
    const report: CostReport = {
      redBuilds: 3,
      ciMinutesLost: 52,
      peopleAffected: 2,
      retries: 1,
      windowDays: 30,
      perSignature: [
        {
          signatureId: FLAKY_SIGNATURE.id,
          signatureShort: 'S-aaa',
          title: 'expected true to be false',
          occurrences: 3,
          ciMinutesLost: 52,
          peopleAffected: 2,
          retries: 1,
        },
      ],
    };
    const rows = toCostRows(report, shortId);
    expect(rows).toHaveLength(1);
    expect(rows[0].ciMinutesLost).toBe(52);
    expect(rows[0].shortId).toBe('S-aaa');
  });
});

describe('formatage des valeurs', () => {
  it('formate les minutes', () => {
    expect(formatMinutes(90)).toBe('1.5 min');
    expect(formatMinutes(30)).toBe('0.5 min');
  });

  it('formate les dates dans les deux langues', () => {
    expect(formatDate('2026-11-03T10:00:00Z', 'fr')).toBe('03/11/2026');
    expect(formatDate('2026-11-03T10:00:00Z', 'en')).toBe('11/03/2026');
    expect(formatDate('pas une date', 'fr')).toBe('pas une date');
  });

  it('abrège un commit', () => {
    expect(shortCommit('abc123456789')).toBe('abc1234');
  });
});

describe('tri du tableau', () => {
  it('ne modifie pas le tableau d\'origine', () => {
    const rows: SignatureRow[] = toSignatureRows(SIGNATURES, shortId, 'en');
    const before = rows.map((r) => r.id);
    sortSignatureRows(rows, 'occurrences');
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
