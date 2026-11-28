/**
 * Période d'abonnement Stripe (#1156). `User.stripeInterval` est un `String` en base (écrit par le
 * webhook) ; le contrat admin (`AdminUser.stripeInterval`) n'accepte que `'month' | 'year' | null`.
 * Valeur inconnue → `null` : l'admin la traitait déjà comme « pas annuel ».
 */
export function billingInterval(value: string | null): 'month' | 'year' | null {
  return value === 'month' || value === 'year' ? value : null;
}

/** Ligne utilisateur avec sa période rétrécie au contrat. */
export function withBillingInterval<T extends { stripeInterval: string | null }>(
  row: T,
): Omit<T, 'stripeInterval'> & { stripeInterval: 'month' | 'year' | null } {
  return { ...row, stripeInterval: billingInterval(row.stripeInterval) };
}
