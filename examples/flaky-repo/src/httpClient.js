// Client HTTP — contient la régression réelle du scénario de démonstration.
// La version corrigée rafraîchissait le descripteur de jeton avant chaque
// appel ; celle-ci a perdu ce rafraîchissement (commit de régression).
export function buildAuthHeader(session) {
  return `Bearer ${session.token.toUpperCase()}`;
}
