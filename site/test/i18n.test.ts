/**
 * Aucune chaîne du site ne peut manquer (§ 18 : l'interface existe en anglais
 * et en français).
 *
 * Trois contrôles :
 *  1. chaque clé de la table rend du texte dans les deux langues ;
 *  2. chaque clé **utilisée** dans `site/src/**` existe — le test lit les
 *     sources et rejoue les appels `t('…')`, donc un libellé oublié casse la CI
 *     au lieu d'afficher `col.mystere` au visiteur ;
 *  3. les clés construites dynamiquement (les cinq diagnostics, les cinq
 *     étapes) sont vérifiées une par une.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DiagnosticKind } from '@dejavu/core';
import { fill, siteKeys, t } from '../src/lib/i18n';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Tous les fichiers `.ts` du site. */
function sources(dossier: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dossier)) {
    const path = join(dossier, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** Les clés demandées littéralement par `t('…')` dans les sources. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sources()) {
    for (const match of readFileSync(file, 'utf8').matchAll(/[^.\w]t\(\s*'([^']+)'/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

const KINDS: DiagnosticKind[] = ['flaky', 'already-fixed', 'new', 'infrastructure', 'uncertain'];

describe('textes du site', () => {
  it('traduit chaque clé de la table dans les deux langues', () => {
    for (const key of siteKeys()) {
      expect(t(key, 'en').length, key).toBeGreaterThan(0);
      expect(t(key, 'fr').length, key).toBeGreaterThan(0);
      expect(t(key, 'en'), key).not.toBe(key);
      expect(t(key, 'fr'), key).not.toBe(key);
    }
  });

  it('connaît chaque clé utilisée par les sections', () => {
    const used = usedKeys();
    expect(used.length).toBeGreaterThan(20);
    for (const key of used) {
      expect(t(key, 'en'), key).not.toBe(key);
      expect(t(key, 'fr'), key).not.toBe(key);
    }
  });

  it('connaît les cinq diagnostics et les cinq étapes (clés dynamiques)', () => {
    for (const kind of KINDS) {
      expect(t(`kind.${kind}`, 'fr'), kind).not.toBe(`kind.${kind}`);
      expect(t(`kind.${kind}`, 'en').length).toBeGreaterThan(10);
    }
    for (const step of [1, 2, 3, 4, 5]) {
      expect(t(`how.s${step}.title`, 'fr')).not.toBe(`how.s${step}.title`);
      expect(t(`how.s${step}.text`, 'en')).not.toBe(`how.s${step}.text`);
    }
  });

  it('remplace les valeurs d’un gabarit', () => {
    expect(fill('Replayed in {ms} ms', { ms: 42 })).toBe('Replayed in 42 ms');
    expect(fill('{a} et {b}', { a: 1, b: 2 })).toBe('1 et 2');
    expect(fill('{inconnu}', { a: 1 })).toBe('{inconnu}');
  });

  it('retombe sur la table partagée du produit', () => {
    // `cost.*` n’est pas dans la table du site : il vient de `@dejavu/present`.
    expect(siteKeys()).not.toContain('cost.minutesLost');
    expect(t('cost.minutesLost', 'fr')).toBe('Minutes de CI perdues');
  });
});
