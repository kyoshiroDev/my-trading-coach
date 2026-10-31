import { parseUsNumber, splitCsvLine } from './csv-parsers';
import { normFillId } from './tradovate-pair.util';

/**
 * Frais Tradovate COMPLETS par fill, lus dans le Cash History (#783) : commission, mais aussi
 * Exchange Fee, Clearing Fee, Nfa Fee… (2,18 $ par côté-contrat sur ES le 27/10, dont 0,59 $ de
 * commission seulement). Avant, seule la commission comptait : P&L net surestimé.
 *
 * Jointure : une ligne de frais appartient au fill de MÊME horodatage (à la seconde) et MÊME
 * contrat dont l'identifiant est le plus grand sous le sien. Tradovate numérote fills et lignes
 * de trésorerie dans une même suite : fill 718793600007, puis ses 4 frais 008 à 011. L'ancienne
 * règle « Transaction ID − 1 = fill » ne tenait pas (décalage variable : 0/30 sur l'export du
 * 27/10, où il valait 4). Vérifié au centime (74,12 $) sur cet export, y compris deux secondes à
 * deux fills.
 */

/** Un fill connu, avec l'horodatage et le contrat tels que les rapports Tradovate les écrivent. */
export interface TradovateFillStamp {
  id: string;
  timestamp: string;
  contract: string;
}

export interface TradovateFeesByFill {
  feeByFill: Map<string, number>;
  /** Σ des lignes de frais du fichier (checksum attendu), rattachées ou non. */
  expected: number;
  /** Lignes de frais sans fill correspondant (fill hors du lot, position encore ouverte…). */
  orphans: number;
}

/** Type de ligne compté comme frais : « Commission » ou « … Fee ». Trade Paired, Fund Transaction… exclus. */
export function isTradovateFeeType(type: string): boolean {
  return /^(commission|.*\bfee)$/i.test(type.trim());
}

const stampKey = (timestamp: string, contract: string) => `${timestamp.trim()}|${contract.trim().toUpperCase()}`;

/** null si le texte n'est pas un Cash History (colonnes attendues absentes). */
export function cashHistoryFeesByFill(cashCsv: string, fills: TradovateFillStamp[]): TradovateFeesByFill | null {
  const lines = cashCsv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return null;
  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, '')).map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const [iTxn, iTs, iDelta, iType, iContract] = [
    col('transaction id'), col('timestamp'), col('delta'), col('cash change type'), col('contract'),
  ];
  if ([iTxn, iTs, iDelta, iType, iContract].some((i) => i < 0)) return null;

  // Fills par (horodatage, contrat), triés : le propriétaire d'une ligne est le dernier fill sous elle.
  const byStamp = new Map<string, bigint[]>();
  for (const f of fills) {
    const id = normFillId(f.id);
    if (!id) continue;
    const k = stampKey(f.timestamp, f.contract);
    const list = byStamp.get(k) ?? [];
    if (!list.includes(BigInt(id))) list.push(BigInt(id));
    byStamp.set(k, list);
  }
  for (const list of byStamp.values()) list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const feeByFill = new Map<string, number>();
  let expected = 0;
  let orphans = 0;
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    if (!isTradovateFeeType(c[iType] ?? '')) continue;
    const amount = Math.abs(parseUsNumber(c[iDelta]) || 0);
    const txn = normFillId(c[iTxn]);
    if (amount <= 0 || !txn) continue;
    expected += amount;
    const owner = (byStamp.get(stampKey(c[iTs] ?? '', c[iContract] ?? '')) ?? [])
      .filter((id) => id < BigInt(txn))
      .pop();
    if (owner === undefined) {
      orphans++;
      continue;
    }
    const k = String(owner);
    feeByFill.set(k, +((feeByFill.get(k) ?? 0) + amount).toFixed(2));
  }
  return { feeByFill, expected: +expected.toFixed(2), orphans };
}

/** Fills d'un export / rapport Performance (buyFillId + boughtTimestamp, sellFillId + soldTimestamp). */
export function performanceFillStamps(performanceCsv: string): TradovateFillStamp[] {
  const lines = performanceCsv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, '')).map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n);
  const [iSym, iBuy, iSell, iBoughtTs, iSoldTs] = [
    col('symbol'), col('buyfillid'), col('sellfillid'), col('boughttimestamp'), col('soldtimestamp'),
  ];
  if ([iSym, iBuy, iSell, iBoughtTs, iSoldTs].some((i) => i < 0)) return [];
  return lines.slice(1).flatMap((line) => {
    const c = splitCsvLine(line);
    const contract = c[iSym] ?? '';
    return [
      { id: c[iBuy] ?? '', timestamp: c[iBoughtTs] ?? '', contract },
      { id: c[iSell] ?? '', timestamp: c[iSoldTs] ?? '', contract },
    ];
  });
}

/** Fills d'un rapport `Fills` (Fill ID, Timestamp, Contract). */
export function fillsReportStamps(fillsCsv: string): TradovateFillStamp[] {
  const lines = fillsCsv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, '')).map((h) => h.trim().toLowerCase());
  const [iId, iTs, iContract] = [header.indexOf('fill id'), header.indexOf('timestamp'), header.indexOf('contract')];
  if ([iId, iTs, iContract].some((i) => i < 0)) return [];
  return lines.slice(1).map((line) => {
    const c = splitCsvLine(line);
    return { id: c[iId] ?? '', timestamp: c[iTs] ?? '', contract: c[iContract] ?? '' };
  });
}
