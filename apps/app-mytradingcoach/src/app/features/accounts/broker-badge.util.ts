/**
 * Pastille d'identité d'une prop firm (texte libre `broker`) : initiales + couleur.
 *
 * Règle : **deux firms différentes n'ont jamais la même couleur dans la liste d'un utilisateur**.
 * Chaque firm a une couleur préférée stable (hash de son nom normalisé : casse, accents et
 * ponctuation sans effet), identique pour tous les utilisateurs tant qu'elle n'entre pas en conflit.
 * En cas de conflit, la firm dont le premier compte est le plus ancien garde sa couleur, l'autre
 * prend la première teinte libre : ajouter une firm ne recolore jamais une firm déjà présente.
 * Au-delà de la palette, des teintes supplémentaires sont générées (toujours hors rouge / vert).
 */

export interface BrokerTone {
  /** Fond de la pastille et accent du compte (liseré, icône, tag). */
  color: string;
  /** Texte contrasté sur ce fond. */
  text: string;
}

export interface BrokerBadge extends BrokerTone {
  initials: string;
}

const DARK_TEXT = '#0b1220';

interface PaletteTone extends BrokerTone {
  /** Teinte HSL (°), null pour un neutre : sert à écarter les couleurs trop proches. */
  hue: number | null;
}

/**
 * 6 teintes nettement distinctes, sans rouge ni vert (perte et gain dans l'app) ni l'orange du
 * bouton « Connecter ». Pas de nuances voisines (rose / fuchsia, bleu / indigo / bleu ciel) : deux
 * firms côte à côte doivent se distinguer d'un coup d'œil. Ordre = ordre d'attribution des
 * teintes libres : les plus contrastées d'abord.
 */
const PALETTE: readonly PaletteTone[] = [
  { color: 'var(--blue)', text: '#fff', hue: 217 },
  { color: 'var(--yellow)', text: DARK_TEXT, hue: 45 },
  { color: 'var(--purple)', text: '#fff', hue: 258 },
  { color: 'var(--cyan)', text: DARK_TEXT, hue: 188 },
  { color: '#f472b6', text: DARK_TEXT, hue: 330 }, // rose
  { color: '#cbd5e1', text: DARK_TEXT, hue: null }, // ardoise claire
];

/** Écart minimal entre une teinte générée et les teintes déjà utilisées. */
const MIN_HUE_GAP = 25;

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

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
 * Teinte supplémentaire n° k (au-delà de la palette) : angle d'or dans les plages autorisées
 * (jaune 40-60°, cyan → rose 180-330°), luminosité moyenne, texte sombre.
 */
function generatedTone(k: number): PaletteTone {
  const ranges: [number, number][] = [[40, 60], [180, 330]];
  const span = ranges.reduce((n, [a, b]) => n + (b - a), 0);
  let pos = ((k + 1) * 137.508) % span;
  let hue = 0;
  for (const [a, b] of ranges) {
    if (pos < b - a) { hue = a + pos; break; }
    pos -= b - a;
  }
  return { color: `hsl(${Math.round(hue)} 70% 62%)`, text: DARK_TEXT, hue: Math.round(hue) };
}

function toneOf({ color, text }: PaletteTone): BrokerTone {
  return { color, text };
}

/** Couleur préférée d'une firm, hors conflit (même valeur pour tous les utilisateurs). */
export function preferredTone(broker: string | null | undefined): BrokerTone | null {
  const normalized = normalizeBrokerName(broker ?? '');
  return normalized ? toneOf(PALETTE[hash(normalized) % PALETTE.length]) : null;
}

/**
 * Attribue une couleur DISTINCTE à chaque firm d'une liste de comptes. `firms` doit être dans
 * l'ordre d'ancienneté (premier compte le plus ancien d'abord) : c'est l'ordre de priorité en
 * cas de conflit. Clés de la map = noms normalisés.
 */
export function assignBrokerTones(firms: Iterable<string | null | undefined>): Map<string, BrokerTone> {
  const tones = new Map<string, BrokerTone>();
  const used: PaletteTone[] = [];
  const free = (t: PaletteTone) => !used.some((u) => u.color === t.color);
  // Teinte générée : loin de toutes celles déjà prises ; après 60 essais, seule l'unicité compte.
  const farEnough = (t: PaletteTone, attempt: number) =>
    attempt > 60 || used.every((u) => u.hue == null || t.hue == null || hueGap(u.hue, t.hue) >= MIN_HUE_GAP);
  let extra = 0;
  for (const firm of firms) {
    const key = normalizeBrokerName(firm ?? '');
    if (!key || tones.has(key)) continue;
    const preferred = PALETTE[hash(key) % PALETTE.length];
    let tone = free(preferred) ? preferred : PALETTE.find(free);
    for (let attempt = 0; !tone; attempt++) {
      const candidate = generatedTone(extra++);
      if (free(candidate) && farEnough(candidate, attempt)) tone = candidate;
    }
    tones.set(key, toneOf(tone));
    used.push(tone);
  }
  return tones;
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

/**
 * Pastille d'une firm. `tones` = attribution de la liste affichée (assignBrokerTones) ; sans elle,
 * couleur préférée (hors gestion des conflits). Pas de firm → pas de pastille.
 */
export function brokerBadge(broker: string | null | undefined, tones?: Map<string, BrokerTone>): BrokerBadge | null {
  const normalized = normalizeBrokerName(broker ?? '');
  if (!normalized) return null;
  const tone = tones?.get(normalized) ?? preferredTone(normalized)!;
  return { initials: initialsOf(normalized), ...tone };
}
