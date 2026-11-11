// Limiteur de remboursement — le code « sain » que le test instable fait
// échouer de façon aléatoire. Ne pas corriger : l'échec vient du test.
export function limitsRefund(amount, ceiling = 100) {
  if (amount > ceiling) return { ok: false, reason: 'over-ceiling' };
  return { ok: true, amount };
}
