/**
 * Pastille d'identité d'une prop firm (texte libre `broker`) : initiales + couleur stable.
 * Même nom → même pastille pour tous les utilisateurs, quelle que soit la casse, les accents
 * ou la ponctuation saisis (« Apex Trader Funding » = « apex trader funding. »).
 */

export interface BrokerBadge {
  initials: string;
  /** Fond de la pastille (variable CSS du design system). */
  color: string;
  /** Texte contrasté sur ce fond. */
  text: string;
}

/**
 * Teintes du design system, sans rouge ni vert : dans l'app ils signifient perte et gain,
 * une firm ne doit pas avoir l'air « en perte » à cause de son nom.
 */
const PALETTE: readonly { color: string; text: string }[] = [
  { color: 'var(--blue)', text: '#fff' },
  { color: 'var(--purple)', text: '#fff' },
  { color: 'var(--cyan)', text: '#0b1220' },
  { color: 'var(--yellow)', text: '#0b1220' },
  { color: 'var(--blue-bright)', text: '#0b1220' },
  { color: 'var(--purple-bright)', text: '#0b1220' },
];

/** Mots génériques des noms de firms : ils ne distinguent pas une firm d'une autre. */
const GENERIC_WORDS = new Set([
  'trading', 'trader', 'traders', 'funding', 'funded', 'capital', 'prop', 'firm',
  'the', 'llc', 'ltd', 'inc', 'group', 'de', 'la', 'le', 'les', 'du', 'des', 'et',
]);

/** Minuscules, sans accents, mots alphanumériques séparés par un espace. */
export function normalizeBrokerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** FNV-1a 32 bits : rapide, stable entre navigateurs, bien réparti sur des chaînes courtes. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Initiales : premières lettres des deux premiers mots significatifs, sinon les deux premières
 * lettres du seul mot significatif (« Take Profit Trader » → TP, « Apex Trader Funding » → AP,
 * « FTMO » → FT). Si tous les mots sont génériques, on les garde plutôt que de ne rien afficher.
 */
function initialsOf(normalized: string): string {
  const words = normalized.split(' ');
  const significant = words.filter((w) => !GENERIC_WORDS.has(w));
  const pool = significant.length ? significant : words;
  const letters = pool.length >= 2 ? pool[0][0] + pool[1][0] : pool[0].slice(0, 2);
  return letters.toUpperCase();
}

export function brokerBadge(broker: string | null | undefined): BrokerBadge | null {
  const normalized = normalizeBrokerName(broker ?? '');
  if (!normalized) return null;
  const tone = PALETTE[hash(normalized) % PALETTE.length];
  return { initials: initialsOf(normalized), color: tone.color, text: tone.text };
}
