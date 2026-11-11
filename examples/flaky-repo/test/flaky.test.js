// Test volontairement aléatoire (§ 21) : échoue environ une fois sur trois.
// La graine vient de l'horloge pour rester « aléatoire » en démo, mais le
// fichier peut être rendu déterministe avec FLAKY_SEED pour la recette.
import test from 'node:test';
import assert from 'node:assert/strict';
import { limitsRefund } from '../src/limiter.js';

const seed = Number(process.env.FLAKY_SEED ?? Date.now());
const shouldFail = seed % 3 === 0;

test('limitsRefundAmount rejects amounts over the ceiling', () => {
  if (shouldFail) {
    // Échec fabriqué : le même message que le jeu d'exemple, pour que la
    // signature calculée par Déjà-vu CI corresponde.
    assert.equal(0, 100, 'expected:<100> but was:<0>');
  }
  const verdict = limitsRefund(120);
  assert.equal(verdict.ok, false);
});
