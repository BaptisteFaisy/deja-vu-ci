/**
 * Le bundle publié correspond-il au dépôt ? Et le site est-il vraiment autonome ?
 *
 * `site/public/` est **commité** (le workflow Pages ne construit rien) : sans
 * ce test, une modification du moteur ou du jeu d'exemple laisserait le site
 * public raconter autre chose que le dépôt. L'empreinte recalcule ici couvre le
 * site, `packages/core`, `packages/present` et le jeu d'exemple.
 *
 * Second contrat : rien ne quitte le navigateur — aucune ressource externe
 * (pas de CDN, pas de police distante, pas d'appel réseau dans le bundle).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC, fingerprint } from '../../tools/build-site.mjs';

/** Lit un fichier publié, en texte. */
function publie(nom) {
  return readFileSync(join(PUBLIC, nom), 'utf8');
}

describe('site public publié', () => {
  it('a été construit et contient les quatre fichiers servis', () => {
    for (const nom of ['index.html', 'styles.css', 'bundle.js', 'build-manifest.json', 'icon.svg']) {
      expect(existsSync(join(PUBLIC, nom)), nom).toBe(true);
    }
    expect(statSync(join(PUBLIC, 'bundle.js')).size).toBeGreaterThan(50_000);
  });

  it('correspond aux sources actuelles (empreinte)', () => {
    const manifeste = JSON.parse(publie('build-manifest.json'));
    expect(manifeste.empreinte).toBe(fingerprint());
  });

  it('ne charge rien depuis l’extérieur', () => {
    const html = publie('index.html');
    expect(html).toContain('./bundle.js');
    expect(html).toContain('./styles.css');
    for (const attribute of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(attribute[1], attribute[1]).toMatch(/^(?:\.\/|#|https:\/\/github\.com\/BaptisteFaisy\/deja-vu-ci)/);
    }
    expect(publie('styles.css')).not.toContain('@import');
    // Quatre origines apparaissent dans le bundle, et aucune n'est un
    // chargement : `github.com` est le lien vers le dépôt ; les trois autres
    // viennent des **données** du jeu d'exemple (URL de builds Bitbucket, et
    // deux URL citées dans des extraits de journaux). Si cette liste change,
    // c'est qu'une URL externe est entrée dans le site : à justifier ici.
    const origines = new Set(
      [...publie('bundle.js').matchAll(/https?:\/\/[^/"'`)\s]+/g)].map((m) => m[0]),
    );
    expect([...origines].sort()).toEqual([
      'https://bitbucket.org',
      'https://docs.docker.com',
      'https://github.com',
      'https://registry.npmjs.org',
    ]);
    // Aucune requête n'est possible : pas de fetch, pas de XHR, pas de worker.
    expect(publie('bundle.js')).not.toMatch(/\bfetch\(/);
    expect(publie('bundle.js')).not.toContain('XMLHttpRequest');
    expect(publie('bundle.js')).not.toContain('importScripts');
  });
});
