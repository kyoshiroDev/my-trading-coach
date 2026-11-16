/**
 * Pseudo masqué d'un filleul : 2 premières lettres + étoiles. Ce que voit un parrain ou un
 * ambassadeur (tiers) de ses filleuls : jamais le nom complet ni l'e-mail (RGPD, S2 #1063).
 */
export function maskPseudo(name: string | null, email: string): string {
  const base = (name?.trim() || email.split('@')[0] || '?').trim();
  const head = base.slice(0, 2).toUpperCase();
  return `${head}${'*'.repeat(Math.max(3, Math.min(6, base.length - 2)))}`;
}
