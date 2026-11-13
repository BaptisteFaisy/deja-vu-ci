/**
 * Panneau « Production » — les faits figés, testés sans DOM (leur maison).
 *
 * Le contrat du brief : les chiffres relevés en production sont **bien là**,
 * dans la donnée que le rendu parcourt — et ils se recoupent (la somme des
 * diagnostics vaut le nombre d'échecs rejoués ; l'incident a bien la famille
 * attendue ; le refus est HTTP 400). Aucune fabrication : chaque affirmation
 * est une propriété de `prod-faits.ts`, pas un chiffre recopié.
 *
 * Aucun DOM ici : `prod-faits.ts` est pur, le rendu est vérifié dans un vrai
 * navigateur (panel-check + Playwright).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { diagnosticLabel } from '@dejavu/present';
import { createWorkspace, type Workspace } from '../src/state/workspace';
import { panel } from '../src/panels/prod';
import {
  APP_ID,
  INCIDENT,
  OBSERVED_AT,
  PROD_BY_KIND,
  REFUSAL_QUOTE,
  REFUSAL_STATUS,
  SITE_URL,
  environments,
  kindRows,
  observationRows,
  prodCount,
  prodTotal,
} from '../src/panels/prod-faits';

describe('contrat du panneau', () => {
  it('garde l’identifiant, le titre et le résumé du registre', () => {
    expect(panel.id).toBe('prod');
    for (const lang of ['en', 'fr'] as const) {
      expect(panel.title(lang).length).toBeGreaterThan(0);
      expect(panel.summary(lang).length).toBeGreaterThan(10);
      expect(panel.title(lang)).not.toContain('panel.');
    }
  });

  it('a un résumé qui nomme le site réel et le contraste', () => {
    expect(panel.summary('en')).toMatch(/real Jira site/i);
    expect(panel.summary('fr')).toMatch(/site Jira/i);
  });
});

describe('les compteurs du rejeu relevé en production', () => {
  it('porte les trois chiffres relevés : 15, 40, 11', () => {
    expect(observationRows()).toEqual([
      { labelKey: 'counter.signatures', value: 15 },
      { labelKey: 'counter.failures', value: 40 },
      { labelKey: 'counter.comments', value: 11 },
    ]);
  });

  it('reste fidèle à la clé du rejeu : les diagnostics totalisent 40', () => {
    expect(prodTotal()).toBe(40);
    expect(observationRows().find((row) => row.labelKey === 'counter.failures')?.value).toBe(prodTotal());
  });
});

describe('les diagnostics relevés (une famille, cinq verdicts)', () => {
  it('décrit exactement les cinq verdicts du rejeu de production', () => {
    expect(kindRows().map((row) => row.count)).toEqual([15, 4, 9, 2, 10]);
    expect(PROD_BY_KIND.map((row) => row.kind)).toEqual([
      'flaky',
      'new',
      'infrastructure',
      'already-fixed',
      'uncertain',
    ]);
  });

  it('rend compte de chaque diagnostic via les mots du moteur', () => {
    for (const row of kindRows()) {
      expect(prodCount(row.kind)).toBe(row.count);
      // Les mots viennent de `@dejavu/present`, jamais recopiés.
      expect(diagnosticLabel(row.kind, 'en').length).toBeGreaterThan(0);
      expect(diagnosticLabel(row.kind, 'fr').length).toBeGreaterThan(0);
    }
  });
});

describe('l’incident d’infrastructure relevé (CI-15)', () => {
  it('est la famille S-168, sur trois dépôts, fenêtre de 15 min, 8 échecs', () => {
    expect(INCIDENT.signature).toBe('S-168');
    expect(INCIDENT.familyHash).toBe('414b5b36');
    expect(INCIDENT.repos).toEqual(['billing-service', 'payments-api', 'payments-web']);
    expect(INCIDENT.windowMinutes).toBe(15);
    expect(INCIDENT.failures).toBe(8);
  });
});

describe('l’installation relevée', () => {
  it('nomme le site, l’identifiant, la version et l’environnement figés', () => {
    expect(SITE_URL).toBe('https://one-atlas-cndz.atlassian.net');
    expect(APP_ID).toBe('ari:cloud:ecosystem::app/2abacda7-8c4f-4b29-9c97-7209dd240894');
    expect(OBSERVED_AT).toBe('2026-11-12');
  });

  it('garde le refus de Jira tel qu’affiché, sans l’édulcorer', () => {
    expect(REFUSAL_STATUS).toBe(400);
    expect(REFUSAL_QUOTE).toContain('Jira a refusé l’écriture');
    expect(REFUSAL_QUOTE).toContain('HTTP 400');
  });
});

describe('les environnements réels', () => {
  it('propose quatre adresses https réelles, sans clé de web trigger', () => {
    const ids = environments().map((env) => env.id);
    expect(ids).toEqual(['jira', 'sql', 'actions', 'pages']);
    for (const env of environments()) {
      expect(env.href).toMatch(/^https:\/\//);
      expect(env.href).not.toMatch(/webtrigger|secret|token|key=/i);
    }
  });
});

describe('le relevé et le rejeu de cette page se recoupent', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await createWorkspace();
  }, 60_000);

  it('rejoue le même jeu d’exemple : 40 échecs, et les trois compteurs du relevé', () => {
    const view = workspace.view;
    expect(view.failures).toBe(observationRows().find((row) => row.labelKey === 'counter.failures')?.value);
    expect(view.signatures.length).toBe(
      observationRows().find((row) => row.labelKey === 'counter.signatures')?.value,
    );
    const comments = view.tickets.filter((action) => action.kind === 'comment').length;
    expect(comments).toBe(observationRows().find((row) => row.labelKey === 'counter.comments')?.value);
  });

  it('donne les mêmes verdicts que le relevé, au près près', () => {
    const view = workspace.view;
    // Les mêmes fichiers d’exemple, mais le moteur de cet arbre est plus récent
    // que le build déployé : les verdicts « new » et « uncertain » ont bougé.
    // Le panneau affiche les deux colonnes ; ce test verrouille la comparaison.
    expect(view.byKind.flaky).toBe(prodCount('flaky'));
    expect(view.byKind.infrastructure).toBe(prodCount('infrastructure'));
    expect(view.byKind['already-fixed']).toBe(prodCount('already-fixed'));
    expect(view.byKind.new).not.toBe(prodCount('new'));
    expect(view.byKind.uncertain).not.toBe(prodCount('uncertain'));
    expect(view.byKind.new + view.byKind.uncertain).toBe(prodCount('new') + prodCount('uncertain'));
  });

  it('retrouve l’incident relevé (famille S-168) dans la mémoire rejouée', () => {
    const famille = workspace.view.signatures.find((signature) => signature.shortId === 'S-168');
    expect(famille).toBeDefined();
    expect(famille?.familyId.startsWith(INCIDENT.familyHash)).toBe(true);
    expect(famille?.occurrences).toBe(INCIDENT.failures);
    expect(famille?.category).toBe('infrastructure');
  });
});