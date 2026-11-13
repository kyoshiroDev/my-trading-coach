import { roundCents } from '@mtc/shared';
import { detectTradingSession } from './tradovate-pair.util';

/**
 * Regroupement des paires Tradovate en POSITIONS (#956, décision de Greg du 13/11).
 *
 * Tradovate apparie les exécutions deux à deux (`fillPair`) : une position entrée ou sortie en
 * plusieurs morceaux donnait autant de trades que de paires (8 contrats → 5 lignes). Un trade MTC
 * couvre désormais toutes les exécutions d'une position, de l'ouverture jusqu'au retour à plat.
 *
 * Critère : le cumul net signé des exécutions, contrat par contrat (un `positionId` Tradovate
 * couvre une séance entière, pas « d'un plat à l'autre »).
 * - Une position se termine quand le cumul revient à 0.
 * - Retournement (long 2 → short 1 par une seule vente de 3) : l'exécution clôt la position A et
 *   ouvre la position B ; son rôle d'ouverture appartient à B.
 * - Une paire va dans la position que son exécution la plus ancienne ouvre ou agrandit.
 * - Position encore ouverte en fin de données : ses paires sont DIFFÉRÉES (aucun trade avant le
 *   retour à plat). Position ouverte avant les données (`startNet ≠ 0`) : toutes les paires du
 *   contrat sont différées, laissées au rattrapage Reporting (l'ouverture n'est pas visible).
 * - Données incohérentes (cumul final ≠ position attendue, paire sans position) : toutes les
 *   paires du contrat sont mises de côté (`uncertain`), jamais un trade inventé.
 *
 * Code PUR : aucune I/O, partagé par la synchro, le rattrapage Reporting et l'import CSV.
 */

/** Une paire Tradovate, réduite à ce qui sert au regroupement. */
export interface PairLeg {
  /** Index de la paire dans le lot de l'appelant (rendu dans les groupes). */
  idx: number;
  /** Contrat BRUT (MGCZ6, pas MGC) : deux échéances sont deux positions différentes. */
  contract: string;
  buyFillId: string;
  sellFillId: string;
  qty: number;
  buyAt: Date;
  sellAt: Date;
}

/** Une exécution, quand la source la fournit (Trade API `/fill/list`, rapport Fills). */
export interface FillLeg {
  id: string;
  contract: string;
  action: 'Buy' | 'Sell';
  qty: number;
  at: Date;
}

export interface GroupOptions {
  /** Toutes les exécutions connues ; sinon déduites des paires (quantité = somme des paires). */
  fills?: FillLeg[];
  /** Position au début des données, par contrat (`prevPos`), 0 par défaut. */
  startNet?: Map<string, number>;
  /** Position attendue à la fin des données, par contrat (`netPos`) : contrôle de cohérence. */
  endNet?: Map<string, number>;
}

export interface PositionGroup {
  contract: string;
  /** Exécution d'ouverture : identité stable du trade (`tv:<id>`). */
  openFillId: string;
  /** Index des paires de la position, dans l'ordre de clôture. */
  pairIdx: number[];
  /** Toutes les exécutions de la position. */
  fillIds: string[];
}

export interface GroupResult {
  groups: PositionGroup[];
  /** Paires d'une position pas encore à plat, ou ouverte avant les données. */
  deferred: number[];
  /** Paires d'un contrat aux données incohérentes : ni regroupées, ni importées. */
  uncertain: number[];
}

/** Clé d'import stable d'une position Tradovate (même valeur dans les 3 sources). */
export function positionImportKey(openFillId: string): string {
  return `tv:${openFillId}`;
}

/** Ordre total des exécutions : horodatage, puis id (numérique si possible). */
function compareFills(a: { id: string; at: Date }, b: { id: string; at: Date }): number {
  const dt = a.at.getTime() - b.at.getTime();
  if (dt !== 0) return dt;
  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Exécutions d'un contrat déduites des paires (une exécution peut servir à plusieurs paires). */
function fillsFromPairs(pairs: PairLeg[]): FillLeg[] {
  const byId = new Map<string, FillLeg>();
  const add = (id: string, action: 'Buy' | 'Sell', qty: number, at: Date, contract: string) => {
    const f = byId.get(id);
    if (f) f.qty += qty;
    else byId.set(id, { id, contract, action, qty, at });
  };
  for (const p of pairs) {
    add(p.buyFillId, 'Buy', p.qty, p.buyAt, p.contract);
    add(p.sellFillId, 'Sell', p.qty, p.sellAt, p.contract);
  }
  return [...byId.values()];
}

const EPS = 1e-9;
const isZero = (n: number) => Math.abs(n) < EPS;

interface OpenPosition {
  openFillId: string;
  fillIds: string[];
}

export function groupPositions(pairs: PairLeg[], opts: GroupOptions = {}): GroupResult {
  const result: GroupResult = { groups: [], deferred: [], uncertain: [] };
  const byContract = new Map<string, PairLeg[]>();
  for (const p of pairs) {
    const list = byContract.get(p.contract) ?? [];
    list.push(p);
    byContract.set(p.contract, list);
  }

  for (const [contract, contractPairs] of byContract) {
    const all = contractPairs.map((p) => p.idx);
    if (!isZero(opts.startNet?.get(contract) ?? 0)) {
      result.deferred.push(...all);
      continue;
    }

    // Exécutions : celles fournies pour ce contrat, complétées par celles des paires absentes.
    const fromPairs = fillsFromPairs(contractPairs);
    const given = (opts.fills ?? []).filter((f) => f.contract === contract);
    const known = new Set(given.map((f) => f.id));
    const fills = [...given, ...fromPairs.filter((f) => !known.has(f.id))].sort(compareFills);

    // Parcours du cumul net : rôle d'ouverture / agrandissement de chaque exécution.
    let net = 0;
    let current: OpenPosition | null = null;
    const closed: OpenPosition[] = [];
    const entryOf = new Map<string, OpenPosition>(); // exécution → position qu'elle ouvre/agrandit

    for (const f of fills) {
      const q = f.action === 'Buy' ? f.qty : -f.qty;
      if (!current || isZero(net)) {
        current = { openFillId: f.id, fillIds: [f.id] };
        entryOf.set(f.id, current);
        net = q;
        continue;
      }
      current.fillIds.push(f.id);
      if (Math.sign(q) === Math.sign(net)) {
        entryOf.set(f.id, current); // agrandissement
        net += q;
        continue;
      }
      const after = net + q;
      if (isZero(after)) {
        closed.push(current);
        current = null;
        net = 0;
      } else if (Math.sign(after) === Math.sign(net)) {
        net = after; // sortie partielle
      } else {
        // Retournement : clôt la position, en ouvre une nouvelle avec le reliquat.
        closed.push(current);
        current = { openFillId: f.id, fillIds: [f.id] };
        entryOf.set(f.id, current);
        net = after;
      }
    }

    const expectedEnd = opts.endNet?.get(contract);
    if (expectedEnd !== undefined && !isZero(expectedEnd - (current ? net : 0))) {
      result.uncertain.push(...all);
      continue;
    }

    // Rattachement de chaque paire par son exécution la plus ancienne.
    const pairsOf = new Map<OpenPosition, PairLeg[]>();
    let incoherent = false;
    for (const p of contractPairs) {
      const first = compareFills({ id: p.buyFillId, at: p.buyAt }, { id: p.sellFillId, at: p.sellAt }) <= 0
        ? p.buyFillId
        : p.sellFillId;
      const pos = entryOf.get(first);
      if (!pos) {
        incoherent = true;
        break;
      }
      const list = pairsOf.get(pos) ?? [];
      list.push(p);
      pairsOf.set(pos, list);
    }
    if (incoherent) {
      result.uncertain.push(...all);
      continue;
    }

    for (const [pos, list] of pairsOf) {
      if (!closed.includes(pos)) {
        result.deferred.push(...list.map((p) => p.idx));
        continue;
      }
      const ordered = [...list].sort(
        (a, b) => Math.max(a.buyAt.getTime(), a.sellAt.getTime()) - Math.max(b.buyAt.getTime(), b.sellAt.getTime()) || a.idx - b.idx,
      );
      result.groups.push({ contract, openFillId: pos.openFillId, pairIdx: ordered.map((p) => p.idx), fillIds: pos.fillIds });
    }
  }

  result.deferred.sort((a, b) => a - b);
  result.uncertain.sort((a, b) => a - b);
  return result;
}

/** Champs d'un trade par paire utiles à l'agrégation. */
export interface GroupableTrade {
  side?: 'LONG' | 'SHORT';
  entry?: number;
  exit?: number;
  quantity?: number;
  pnl?: number;
  commission?: number;
  tradedAt?: string;
  session?: string;
}

/** Arrondi des prix moyens : enlève le bruit des flottants sans toucher aux décimales réelles. */
const roundPrice = (n: number) => Math.round(n * 1e8) / 1e8;

/**
 * Trade d'une position à partir de ses trades par paire :
 * - quantité = somme des contrats des paires (prix moyens × quantité = P&L) ;
 * - entrée et sortie = moyennes pondérées par la quantité ;
 * - P&L = somme des P&L par paire (déjà au centime), pas un recalcul sur les moyennes ;
 * - frais = somme (le fill de retournement est déjà réparti au prorata entre les positions) ;
 * - `tradedAt` = DERNIÈRE clôture (partout, `tradedAt` signifie clôture).
 */
export function aggregateGroup<T extends GroupableTrade>(trades: T[]): T {
  if (trades.length === 0) throw new Error('aggregateGroup : groupe vide');
  if (trades.length === 1) return { ...trades[0] };
  const side = trades[0].side;
  if (trades.some((t) => t.side !== side)) throw new Error('aggregateGroup : sens différents dans une position');

  let qty = 0;
  let entryW = 0;
  let exitW = 0;
  let pnl = 0;
  let commission = 0;
  let hasCommission = false;
  let last = trades[0].tradedAt ?? '';
  for (const t of trades) {
    const q = t.quantity ?? 1;
    qty += q;
    entryW += (t.entry ?? 0) * q;
    exitW += (t.exit ?? 0) * q;
    pnl += t.pnl ?? 0;
    if (t.commission != null) {
      commission += t.commission;
      hasCommission = true;
    }
    if (t.tradedAt && new Date(t.tradedAt).getTime() > new Date(last).getTime()) last = t.tradedAt;
  }

  return {
    ...trades[0],
    side,
    quantity: qty,
    entry: roundPrice(entryW / qty),
    exit: roundPrice(exitW / qty),
    pnl: roundCents(pnl),
    ...(hasCommission ? { commission: roundCents(commission) } : {}),
    tradedAt: last,
    session: last ? detectTradingSession(last) : trades[0].session,
  };
}
