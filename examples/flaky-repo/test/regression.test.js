// Régression réelle (§ 21) : le descripteur de jeton peut être absent, le
// client lève alors une TypeError — exactement l'erreur du jeu d'exemple.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthHeader } from '../src/httpClient.js';

test('refreshToken builds an Authorization header', () => {
  const header = buildAuthHeader({});
  assert.match(header, /^Bearer [A-Z0-9]+$/);
});
