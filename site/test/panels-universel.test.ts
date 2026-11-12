/**
 * Le panneau « Entrée universelle » : la charge, son verdict et les extraits.
 *
 * Les tests vérifient ce que le visiteur voit : une charge valide acceptée,
 * une charge invalide refusée **avec le champ fautif nommé**, les secrets
 * masqués, et des extraits tous bâtis sur la même charge (une seule source de
 * vérité).
 */

import { describe, expect, it } from 'vitest';
import { panel } from '../src/panels/universel';
import {
  EXEMPLES,
  KEY_PLACEHOLDER,
  defaultValues,
  maskPayload,
  validate,
} from '../src/panels/universel-donnees';
import { buildSnippets } from '../src/panels/universel-snippets';
import { GITHUB_LOG, adaptGitHub, adapterPayload } from '../src/panels/universel-adaptateurs';
import { t } from '../src/lib/i18n';

describe('la charge utile', () => {
  it('accepte une charge valide et la normalise', () => {
    const resultat = validate(defaultValues());
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.payload.repository).toBe('octo/payments');
    expect(resultat.payload.branch).toBe('main');
    expect(resultat.payload.step).toBe('make test');
    expect(resultat.payload.log).toContain('##[group]Run make test');
  });

  it('refuse une charge invalide en nommant le champ fautif', () => {
    const sansDepot = validate({ ...defaultValues(), repository: '' });
    expect(sansDepot.ok).toBe(false);
    if (sansDepot.ok) return;
    expect(sansDepot.error).toBe('repository is required');

    const sansJournal = validate({ ...defaultValues(), log: '' });
    expect(sansJournal.ok).toBe(false);
    if (sansJournal.ok) return;
    expect(sansJournal.error).toBe('log is required');

    const sansCle = validate({ ...defaultValues(), projectKey: '  ' });
    expect(sansCle.ok).toBe(false);
    if (sansCle.ok) return;
    expect(sansCle.error).toBe('projectKey is required');
  });

  it('borne le journal à 50 KiB', () => {
    const long = 'x'.repeat(60_000);
    const resultat = validate({ ...defaultValues(), log: long });
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.payload.log.length).toBe(51_200);
  });

  it('masque les secrets du journal et compte ce qu’il a masqué', () => {
    const resultat = validate(defaultValues());
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const masque = maskPayload(resultat.payload);
    expect(masque.payload.log).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(masque.payload.log).not.toContain('dev@example.org');
    expect(masque.payload.log).toContain('«[masqué:aws-key]»');
    expect(masque.masked).toBeGreaterThan(0);
    expect(masque.kinds).toContain('aws-key');
  });

  it('ne réaffiche jamais la clé de projet', () => {
    const resultat = validate(defaultValues());
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(maskPayload(resultat.payload).payload.projectKey).toBe(KEY_PLACEHOLDER);
    expect(maskPayload(resultat.payload).text).not.toContain('placeholder-project-key');
  });
});

describe('les extraits', () => {
  it('sont six, tous bâtis sur la même charge', () => {
    const resultat = validate(defaultValues());
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const masque = maskPayload(resultat.payload);
    const extraits = buildSnippets(masque.payload, defaultValues());
    expect(extraits.map((snippet) => snippet.id)).toEqual([
      'curl',
      'github',
      'gitlab',
      'jenkins',
      'cli',
      'python',
    ]);
    for (const snippet of extraits) {
      expect(snippet.text, snippet.id).toContain('octo/payments');
      expect(snippet.text, snippet.id).toContain('«[masqué:aws-key]»');
      expect(snippet.text, snippet.id).not.toContain('AKIAIOSFODNN7EXAMPLE');
    }
  });

  it('portent la syntaxe réelle de chaque intégration', () => {
    const resultat = validate(defaultValues());
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const extraits = buildSnippets(maskPayload(resultat.payload).payload, defaultValues());
    const parId = new Map(extraits.map((snippet) => [snippet.id, snippet.text]));
    expect(parId.get('curl')).toContain("--data-binary @- <<'DEJAVU_EOF'");
    expect(parId.get('github')).toContain('BaptisteFaisy/deja-vu-ci/integrations/github-action@main');
    expect(parId.get('gitlab')).toContain('.deja-vu-report:');
    expect(parId.get('jenkins')).toContain('post {');
    expect(parId.get('cli')).toContain('deja-vu report');
    expect(parId.get('python')).toContain('from deja_vu_ci import report');
  });

  it('ont un libellé traduit dans les deux langues', () => {
    const extraits = buildSnippets({}, defaultValues());
    for (const snippet of extraits) {
      expect(t(snippet.labelKey, 'en'), snippet.id).not.toBe(snippet.labelKey);
      expect(t(snippet.labelKey, 'fr'), snippet.id).not.toBe(snippet.labelKey);
    }
  });
});

describe('l’adaptateur', () => {
  it('lit le journal brut de GitHub Actions', () => {
    const report = adaptGitHub({
      log: GITHUB_LOG,
      repository: 'octo/payments',
      branch: 'main',
      commit: '9f3c1ab',
    });
    expect(report.format).toBe('github-actions');
    expect(report.step).toBe('make test');
    expect(report.durationS).toBeCloseTo(4.2);
    expect(report.exitCode).toBe(1);
    expect(report.testCases.map((cas) => cas.name)).toHaveLength(2);
  });

  it('produit la charge utile du contrat universel', () => {
    const report = adaptGitHub({
      log: GITHUB_LOG,
      repository: 'octo/payments',
      branch: 'main',
      commit: '9f3c1ab',
    });
    const payload = adapterPayload(report);
    expect(payload.repository).toBe('octo/payments');
    expect(payload.step).toBe('make test');
    expect(payload.projectKey).toBe(KEY_PLACEHOLDER);
    expect(payload.testCases?.length).toBe(2);
  });
});

describe('le panneau', () => {
  it('a un titre et un résumé dans les deux langues', () => {
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(10);
    }
  });

  it('propose un exemple par écosystème', () => {
    expect(EXEMPLES.map((exemple) => exemple.id)).toEqual(['github', 'gitlab', 'jenkins', 'autre']);
    for (const exemple of EXEMPLES) {
      expect(exemple.values.log.length, exemple.id).toBeGreaterThan(10);
      expect(exemple.values.repository.length, exemple.id).toBeGreaterThan(0);
    }
  });
});
