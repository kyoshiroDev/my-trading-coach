/**
 * Import d'un broker inconnu : le modele deduit la CORRESPONDANCE DES COLONNES sur un
 * echantillon, ce fichier parse le reste sans IA.
 *
 * Pourquoi : faire rediger chaque trade par le modele coutait ~1,43 $ pour 2000 lignes
 * (17 appels, 80 000 jetons de sortie). Deduire le mapping coute UN appel, ~0,01 $, et
 * le cout ne depend plus de la taille du fichier. Mesure du 2026-09-28 sur 5 formats.
 *
 * Ce que la mesure a montre, et qui dicte la conception :
 *  - l'identification des colonnes est fiable (30/30 criteres en Sonnet, 29/30 en Haiku) ;
 *  - le SENS (long / short) ne l'est pas : 3/5 pour les deux modeles. C'est le seul champ
 *    ou une erreur corrompt tout le fichier en silence, puisque tous les longs deviennent
 *    des shorts sans que rien ne signale le probleme.
 *
 * D'ou la regle de ce fichier : on fait confiance au modele pour les colonnes, JAMAIS pour
 * le sens. Le sens est verifie par le signe du P&L, qui est une contrainte arithmetique :
 * un long gagne quand la sortie depasse l'entree. Si le mapping contredit les chiffres, on
 * inverse ; si meme inverse il ne colle pas, on rend la main a l'appelant qui retombera sur
 * le chemin IA ligne par ligne. Un import qui coute cher vaut mieux qu'un import faux.
 *
 * Ce que ce garde-fou NE couvre PAS, et qu'il faut savoir :
 *  - un export sans prix d'entree (type Binance Futures) rend le controle impossible :
 *    `pnlRatio` vaut null et l'appelant doit renoncer au mapping ;
 *  - en mode horodatages, permuter les deux colonnes de temps inverse le sens ET
 *    l'entree/sortie en meme temps, donc les deux lectures restent coherentes et le signe
 *    du P&L ne tranche pas. Le risque reste faible (ces colonnes sont nommees sans
 *    ambiguite dans l'export) mais il n'est pas nul ;
 *  - un trade dont les frais depassent le gain brut a un P&L de signe « faux » sans que
 *    rien ne soit casse. C'est pourquoi le seuil est une PART de lignes coherentes
 *    (MAPPING_MIN_PNL_RATIO) et non la perfection.
 */

import { splitCsvLine } from './csv-parsers';
import { resolvePairDirection } from './tradovate-pair.util';

/** Part minimale de lignes exploitables pour accepter un mapping. */
export const MAPPING_MIN_PARSED_RATIO = 0.8;
/** Part minimale de lignes dont le signe du P&L confirme le sens. */
export const MAPPING_MIN_PNL_RATIO = 0.8;
/** Lignes envoyees au modele pour qu'il deduise le mapping. */
export const MAPPING_SAMPLE_ROWS = 20;

export type SideMode = 'column' | 'derived_from_timestamps';

export interface CsvMapping {
  delimiter: string;
  decimalSeparator: '.' | ',';
  columns: {
    symbol: number;
    entry: number | null;
    exit: number;
    quantity: number;
    pnl: number;
    tradedAt: number;
  };
  side: {
    mode: SideMode;
    index: number | null;
    longValues: string[];
    shortValues: string[];
    buyTimeIndex: number | null;
    sellTimeIndex: number | null;
  };
  /** Colonnes a AJOUTER au pnl (commission, swap) : MT5 eclate le resultat net. */
  pnlExtraColumns: number[];
  notes?: string;
}

export interface MappedRow {
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  tradedAt: string;
}

/**
 * Un nombre tel que les brokers l'ecrivent : « 73,602.51 », « 1,6202459USDT », « $23.00 »,
 * « (11.50) » pour un negatif. Tout ce qui n'est pas chiffre, signe ou separateur decimal
 * est retire AVANT conversion, sinon `parseFloat` s'arrete au premier caractere etranger.
 */
export function parseBrokerNumber(raw: string, decimalSeparator: '.' | ','): number {
  if (raw == null) return NaN;

  // Le nettoyage precede le test des parentheses, et ce n'est pas un detail : l'export
  // Tradovate reel ecrit une perte « $(125.00) », symbole monetaire A L'EXTERIEUR de la
  // parenthese. Tester « commence par ( » sur la chaine brute rate ce cas et rend +125
  // au lieu de -125 : le trade change de camp sans qu'aucune erreur ne remonte.
  let s = String(raw).trim().replace(/[^0-9.,()+-]/g, '');
  if (!s) return NaN;

  const negatifParParentheses = s.startsWith('(') && s.endsWith(')');
  if (negatifParParentheses) s = s.slice(1, -1);
  s = s.replace(/[()]/g, '');

  // Le separateur decimal devient un point ; l'autre est un separateur de milliers.
  s = decimalSeparator === ','
    ? s.replace(/\./g, '').replace(/,/g, '.')
    : s.replace(/,/g, '');

  const n = parseFloat(s);
  if (!isFinite(n)) return NaN;
  return negatifParParentheses ? -n : n;
}

function estIndex(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max;
}

/**
 * Valide la FORME de ce que le modele a repondu. Un mapping qui designe une colonne
 * inexistante produirait des `undefined` silencieux sur tout le fichier.
 */
export function validateMappingShape(raw: unknown, columnCount: number): CsvMapping | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const cols = o['columns'] as Record<string, unknown> | undefined;
  const side = o['side'] as Record<string, unknown> | undefined;
  if (!cols || !side) return null;

  const delimiter = typeof o['delimiter'] === 'string' && o['delimiter'].length === 1
    ? (o['delimiter'] as string) : null;
  if (!delimiter) return null;

  const dec = o['decimalSeparator'] === ',' ? ',' : '.';

  if (!estIndex(cols['symbol'], columnCount)) return null;
  if (!estIndex(cols['exit'], columnCount)) return null;
  if (!estIndex(cols['quantity'], columnCount)) return null;
  if (!estIndex(cols['pnl'], columnCount)) return null;
  if (!estIndex(cols['tradedAt'], columnCount)) return null;
  const entry = estIndex(cols['entry'], columnCount) ? (cols['entry'] as number) : null;

  const mode: SideMode = side['mode'] === 'derived_from_timestamps'
    ? 'derived_from_timestamps' : 'column';
  if (mode === 'column' && !estIndex(side['index'], columnCount)) return null;
  if (mode === 'derived_from_timestamps'
      && !(estIndex(side['buyTimeIndex'], columnCount) && estIndex(side['sellTimeIndex'], columnCount))) {
    return null;
  }

  const listeDeChaines = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  const extra = Array.isArray(o['pnlExtraColumns'])
    ? (o['pnlExtraColumns'] as unknown[]).filter((x) => estIndex(x, columnCount)) as number[]
    : [];

  return {
    delimiter,
    decimalSeparator: dec,
    columns: {
      symbol: cols['symbol'] as number,
      entry,
      exit: cols['exit'] as number,
      quantity: cols['quantity'] as number,
      pnl: cols['pnl'] as number,
      tradedAt: cols['tradedAt'] as number,
    },
    side: {
      mode,
      index: estIndex(side['index'], columnCount) ? (side['index'] as number) : null,
      longValues: listeDeChaines(side['longValues']),
      shortValues: listeDeChaines(side['shortValues']),
      buyTimeIndex: estIndex(side['buyTimeIndex'], columnCount) ? (side['buyTimeIndex'] as number) : null,
      sellTimeIndex: estIndex(side['sellTimeIndex'], columnCount) ? (side['sellTimeIndex'] as number) : null,
    },
    pnlExtraColumns: extra,
    notes: typeof o['notes'] === 'string' ? (o['notes'] as string) : undefined,
  };
}

function sensDeLaLigne(cols: string[], m: CsvMapping): 'LONG' | 'SHORT' | null {
  if (m.side.mode === 'derived_from_timestamps') return null; // traite par paireDepuisHorodatages
  const brut = (cols[m.side.index as number] ?? '').trim().toLowerCase();
  if (!brut) return null;
  const colle = (liste: string[]) => liste.some((v) => brut.includes(v.trim().toLowerCase()));
  if (colle(m.side.longValues)) return 'LONG';
  if (colle(m.side.shortValues)) return 'SHORT';
  return null;
}

/**
 * Mode horodatages (Tradovate et assimiles) : les deux colonnes de prix sont un prix d'ACHAT
 * et un prix de VENTE, pas une entree et une sortie. Pour un short, la vente est l'entree et
 * l'achat la sortie, et la date du trade est celle de la CLOTURE. C'est exactement la regle
 * de `resolvePairDirection`, partagee avec le parseur Tradovate et la synchro API : on
 * l'appelle plutot que de la reecrire, sinon les deux chemins divergeraient un jour.
 */
function paireDepuisHorodatages(
  cols: string[],
  m: CsvMapping,
): { side: 'LONG' | 'SHORT'; entry: number; exit: number; tradedAt: Date } | null {
  const buyPrice = m.columns.entry != null
    ? parseBrokerNumber(cols[m.columns.entry] ?? '', m.decimalSeparator) : NaN;
  const sellPrice = parseBrokerNumber(cols[m.columns.exit] ?? '', m.decimalSeparator);
  const boughtAt = new Date((cols[m.side.buyTimeIndex as number] ?? '').trim());
  const soldAt = new Date((cols[m.side.sellTimeIndex as number] ?? '').trim());
  if (!isFinite(buyPrice) || !isFinite(sellPrice)) return null;
  if (isNaN(boughtAt.getTime()) || isNaN(soldAt.getTime())) return null;
  return resolvePairDirection({ buyPrice, sellPrice, boughtAt, soldAt });
}

/** Applique le mapping. Les lignes inexploitables sont comptees, pas devinees. */
export function applyMapping(
  dataLines: string[],
  m: CsvMapping,
): { rows: MappedRow[]; skipped: number } {
  const rows: MappedRow[] = [];
  let skipped = 0;

  for (const brut of dataLines) {
    const ligne = brut.trim();
    if (!ligne) continue;
    const cols = splitCsvLine(ligne, m.delimiter);

    const asset = (cols[m.columns.symbol] ?? '').trim();
    const paire = m.side.mode === 'derived_from_timestamps'
      ? paireDepuisHorodatages(cols, m)
      : null;
    const side = paire ? paire.side : sensDeLaLigne(cols, m);
    const exit = paire
      ? paire.exit
      : parseBrokerNumber(cols[m.columns.exit] ?? '', m.decimalSeparator);
    const entry = paire
      ? paire.entry
      : m.columns.entry != null
        ? parseBrokerNumber(cols[m.columns.entry] ?? '', m.decimalSeparator)
        : 0;
    const quantity = parseBrokerNumber(cols[m.columns.quantity] ?? '', m.decimalSeparator);
    let pnl = parseBrokerNumber(cols[m.columns.pnl] ?? '', m.decimalSeparator);
    for (const i of m.pnlExtraColumns) {
      const extra = parseBrokerNumber(cols[i] ?? '', m.decimalSeparator);
      if (isFinite(extra)) pnl += extra;
    }
    const date = paire ? paire.tradedAt : new Date((cols[m.columns.tradedAt] ?? '').trim());

    if (!asset || !side || !isFinite(exit) || !isFinite(pnl) || isNaN(date.getTime())) {
      skipped++;
      continue;
    }

    rows.push({
      asset,
      side,
      entry: isFinite(entry) ? entry : 0,
      exit,
      quantity: isFinite(quantity) && quantity > 0 ? quantity : 1,
      pnl,
      tradedAt: date.toISOString(),
    });
  }

  return { rows, skipped };
}

/**
 * Le sens est-il compatible avec les chiffres ? Un long gagne quand la sortie depasse
 * l'entree. On ne juge que les lignes ou la question a un sens : il faut un prix d'entree,
 * un P&L non nul, et une sortie differente de l'entree.
 */
export function pnlCoherence(rows: MappedRow[]): { ok: number; testables: number } {
  let ok = 0;
  let testables = 0;
  for (const r of rows) {
    if (!r.entry || r.pnl === 0 || r.exit === r.entry) continue;
    testables++;
    const attenduPositif = r.side === 'LONG' ? r.exit > r.entry : r.exit < r.entry;
    if (attenduPositif === r.pnl > 0) ok++;
  }
  return { ok, testables };
}

export interface MappingOutcome {
  rows: MappedRow[];
  skipped: number;
  /** Le sens indique par le modele a du etre inverse pour coller aux chiffres. */
  flipped: boolean;
  /** Part des lignes testables dont le signe du P&L confirme le sens (null = non testable). */
  pnlRatio: number | null;
}

function inverse(m: CsvMapping): CsvMapping {
  return m.side.mode === 'column'
    ? { ...m, side: { ...m.side, longValues: m.side.shortValues, shortValues: m.side.longValues } }
    : { ...m, side: { ...m.side, buyTimeIndex: m.side.sellTimeIndex, sellTimeIndex: m.side.buyTimeIndex } };
}

/**
 * Applique le mapping et tranche le sens par l'arithmetique plutot que par confiance.
 *
 * Quand le fichier permet la verification, le sens retenu est celui que les chiffres
 * confirment : c'est ce qui rattrape l'erreur que les deux modeles font sur les exports
 * de cloture, ou la colonne de sens designe l'ordre de sortie et doit etre inversee.
 * Quand il ne la permet pas (pas de prix d'entree, comme un export Binance Futures),
 * `pnlRatio` vaut null et l'appelant decide s'il accepte ce risque.
 */
export function applyMappingWithPnlCheck(dataLines: string[], m: CsvMapping): MappingOutcome {
  const direct = applyMapping(dataLines, m);
  const cDirect = pnlCoherence(direct.rows);

  if (cDirect.testables === 0) {
    return { ...direct, flipped: false, pnlRatio: null };
  }

  const ratioDirect = cDirect.ok / cDirect.testables;
  if (ratioDirect >= MAPPING_MIN_PNL_RATIO) {
    return { ...direct, flipped: false, pnlRatio: ratioDirect };
  }

  const retourne = applyMapping(dataLines, inverse(m));
  const cInverse = pnlCoherence(retourne.rows);
  const ratioInverse = cInverse.testables ? cInverse.ok / cInverse.testables : 0;

  return ratioInverse > ratioDirect
    ? { ...retourne, flipped: true, pnlRatio: ratioInverse }
    : { ...direct, flipped: false, pnlRatio: ratioDirect };
}
