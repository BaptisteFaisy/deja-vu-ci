/**
 * L'atelier partagé du site : une mémoire, deux moteurs, une vue dérivée.
 *
 * C'est la pièce maîtresse du site « toutes les fonctionnalités visibles » :
 * les panneaux partagent la même mémoire, donc une fusion de signatures faite
 * dans un panneau se voit dans les autres — comme dans l'app réelle. Ce test
 * vérifie l'atelier hors navigateur (aucun DOM), avec le vrai moteur.
 */

import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../src/state/workspace';

describe('atelier partagé', () => {
  it('rejoue le jeu d’exemple et expose la mémoire', async () => {
    const atelier = await createWorkspace();
    expect(atelier.view.failures).toBe(40);
    expect(atelier.view.signatures.length).toBeGreaterThan(0);
    expect(atelier.result.diagnostics).toHaveLength(40);
    expect((await atelier.store.listSignatures()).length).toBe(atelier.view.signatures.length);
  });

  it('branche le moteur d’actions du Cerveau sur la même mémoire', async () => {
    const atelier = await createWorkspace();
    expect(atelier.brain.store).toBe(atelier.store);
    expect(atelier.brain.signatureShort('b2737785dd7e524d')).toMatch(/^S-/);
    expect(atelier.brain.now().toISOString()).toBe(atelier.now.toISOString());
  });

  it('notify() recalcule la vue depuis le magasin, sans rejouer', async () => {
    const atelier = await createWorkspace();
    const avant = atelier.view.signatures[0];
    await atelier.store.saveSignature({ ...avant, status: 'resolved' });
    await atelier.notify();
    const apres = atelier.view.signatures.find((s) => s.id === avant.id);
    expect(apres?.status).toBe('resolved');
    // Aucun recount : le nombre d'occurrences ne bouge pas.
    expect(apres?.occurrences).toBe(avant.occurrences);
  });

  it('reload() repart d’une mémoire neuve', async () => {
    const atelier = await createWorkspace();
    const memoireAvant = atelier.store;
    await atelier.reload();
    expect(atelier.store).not.toBe(memoireAvant);
    expect(atelier.view.failures).toBe(40);
  });

  it('prévient les panneaux abonnés, et sait les désabonner', async () => {
    const atelier = await createWorkspace();
    let appels = 0;
    const desabonner = atelier.subscribe(() => {
      appels += 1;
    });
    await atelier.notify();
    expect(appels).toBe(1);
    desabonner();
    await atelier.notify();
    expect(appels).toBe(1);
  });
});
