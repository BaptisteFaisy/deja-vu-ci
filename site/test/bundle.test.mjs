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
import { pathToFileURL } from 'node:url';
import { PUBLIC, fingerprint } from '../../tools/build-site.mjs';

/** Lit un fichier publié, en texte. */
function publie(nom) {
  return readFileSync(join(PUBLIC, nom), 'utf8');
}

describe('site public publié', () => {
  it('a été construit et contient les quatre fichiers servis', () => {
    for (const nom of ['index.html', 'styles.css', 'bundle.js', 'mask.js', 'build-manifest.json', 'icon.svg']) {
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
    // Six origines apparaissent dans le bundle, et aucune n'est un chargement :
    // `github.com` est le lien vers le dépôt ; `bitbucket.org` est l'URL de
    // builds du jeu d'exemple ; `docs.docker.com` et `registry.npmjs.org`
    // viennent d'extraits de journaux du jeu d'exemple. Les deux dernières,
    // `registry.internal.example` (un registre npm fictif) et
    // `repo.maven.apache.org` (Maven Central), ne sont que du **texte cité**
    // dans les journaux fictifs du corpus étiqueté embarqué par le panneau
    // « Justesse » — jamais chargées. Si cette liste change, c'est qu'une URL
    // externe est entrée dans le site : à justifier ici.
    const origines = new Set(
      [...publie('bundle.js').matchAll(/https?:\/\/[^/"'`)\s]+/g)].map((m) => m[0]),
    );
    expect([...origines].sort()).toEqual([
      'https://bitbucket.org',
      'https://docs.docker.com',
      'https://github.com',
      'https://registry.internal.example',
      'https://registry.npmjs.org',
      'https://repo.maven.apache.org',
    ]);
    // Aucune requête n'est possible : pas de fetch, pas de XHR, pas de worker.
    expect(publie('bundle.js')).not.toMatch(/\bfetch\(/);
    expect(publie('bundle.js')).not.toContain('XMLHttpRequest');
    expect(publie('bundle.js')).not.toContain('importScripts');
  });

  it('publie le module de masquage chargé en différé par l’entrée universelle', async () => {
    const module = await import(pathToFileURL(join(PUBLIC, 'mask.js')).href);
    expect(typeof module.maskSecrets).toBe('function');
    const masque = module.maskSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0');
    expect(masque.masked).toBeGreaterThan(0);
    expect(masque.text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });
});
