import type { CreateTradeDto } from '../../trades/dto/create-trade.dto';
import type { FeesReport } from '../../trades/csv-import.service';
import { getTickSize, getTickValue } from '../../trades/instruments.const';
import {
  assignFeesOncePerFill,
  detectTradingSession,
  normFillId,
  normalizeFuturesSymbol,
  resolvePairDirection,
} from '../../trades/tradovate-pair.util';
import type {
  TradovateContract,
  TradovateContractMaturity,
  TradovateFill,
  TradovateFillFee,
  TradovateFillPair,
  TradovateProduct,
} from './tradovate.types';

/** DTO d'import + fill ids (métadonnée interne, retirée avant persistance). */
export type TradovateTradeDto = Partial<CreateTradeDto> & {
  _buyFillId?: string;
  _sellFillId?: string;
};

export interface TradovateMapperInput {
  pairs: TradovateFillPair[];
  fills: Map<number, TradovateFill>;
  /** null = frais indisponibles (endpoint refusé) : trades importés sans frais, P&L brut. */
  fees: Map<number, TradovateFillFee> | null;
  contracts: Map<number, TradovateContract>;
  maturities: Map<number, TradovateContractMaturity>;
  products: Map<number, TradovateProduct>;
}

export interface TradovateMapperResult {
  trades: TradovateTradeDto[];
  /** Paires non convertibles (fill ou contrat introuvable, valeur du point inconnue). */
  skipped: number;
  fees: FeesReport;
}

/** Somme de tous les frais d'un fill (commission, exchange, clearing, NFA…), en positif. */
export function totalFillFee(f: TradovateFillFee): number {
  const parts = [
    f.commission, f.clearingFee, f.exchangeFee, f.nfaFee,
    f.brokerageFee, f.ipFee, f.orderRoutingFee,
  ];
  return +parts.reduce<number>((s, v) => s + Math.abs(v ?? 0), 0).toFixed(2);
}

/**
 * Tronque à la seconde : l'export Performance est à la seconde. Même granularité des deux
 * côtés → l'empreinte `importHash` (qui contient `tradedAt`) peut coïncider.
 */
export function toSecond(iso: string): Date {
  const ms = new Date(iso).getTime();
  return new Date(Math.floor(ms / 1000) * 1000);
}

/** Valeur d'un point : produit Tradovate, sinon référentiel interne (tickValue / tickSize). */
function valuePerPoint(
  symbol: string,
  contract: TradovateContract,
  input: TradovateMapperInput,
): number | null {
  const maturity = input.maturities.get(contract.contractMaturityId);
  const product = maturity ? input.products.get(maturity.productId) : undefined;
  if (product && product.valuePerPoint > 0) return product.valuePerPoint;

  const tickValue = getTickValue(symbol);
  const tickSize = getTickSize(symbol);
  return tickValue && tickSize ? tickValue / tickSize : null;
}

/**
 * Convertit les paires de fills Tradovate en trades MTC, sous la forme EXACTE d'un import CSV
 * Tradovate (même symbole, sens, entrée/sortie, date de clôture, P&L brut, frais par fill
 * comptés une fois). Pure : aucune I/O, testable sans réseau.
 *
 * P&L = P&L BRUT de la paire, `(vente − achat) × qty × valeur du point`, arrondi au centime,
 * comme la colonne `pnl` de l'export Performance. Les frais vont dans `commission` : le net
 * est déduit en aval, exactement comme pour le CSV.
 */
export function mapTradovatePairs(input: TradovateMapperInput): TradovateMapperResult {
  type Row = { dto: TradovateTradeDto; closedAt: number };
  const rows: Row[] = [];
  let skipped = 0;

  for (const pair of input.pairs) {
    if (pair.active === false) continue; // paire annulée (fill cassé côté broker)
    const buy = input.fills.get(pair.buyFillId);
    const sell = input.fills.get(pair.sellFillId);
    const contract = buy ? input.contracts.get(buy.contractId) : undefined;
    if (!buy || !sell || !contract) {
      skipped++;
      continue;
    }

    const asset = normalizeFuturesSymbol(contract.name);
    const vpp = valuePerPoint(asset, contract, input);
    if (vpp == null) {
      skipped++;
      continue;
    }

    const { side, entry, exit, tradedAt } = resolvePairDirection({
      buyPrice: pair.buyPrice,
      sellPrice: pair.sellPrice,
      boughtAt: new Date(buy.timestamp),
      soldAt: new Date(sell.timestamp),
    });
    const closedAt = toSecond(tradedAt.toISOString());
    const iso = closedAt.toISOString();

    rows.push({
      closedAt: closedAt.getTime(),
      dto: {
        asset,
        side,
        entry,
        exit,
        quantity: pair.qty,
        pnl: +((pair.sellPrice - pair.buyPrice) * pair.qty * vpp).toFixed(2),
        emotion: null, // override optionnel, comme l'import CSV (PROMPT-163)
        session: detectTradingSession(iso),
        timeframe: '1h',
        tradedAt: iso,
        _buyFillId: normFillId(pair.buyFillId) ?? undefined,
        _sellFillId: normFillId(pair.sellFillId) ?? undefined,
      },
    });
  }

  // Ordre chronologique de clôture : l'attribution « un fill = une fois » donne ses frais au
  // premier trade qui le touche, comme l'ordre du fichier pour le CSV.
  rows.sort((a, b) => a.closedAt - b.closedAt);
  const trades = rows.map((r) => r.dto);

  return { trades, skipped, fees: assignFees(trades, input.fees) };
}

function assignFees(
  trades: TradovateTradeDto[],
  fees: Map<number, TradovateFillFee> | null,
): FeesReport {
  if (!fees) {
    // Même signal que le CSV sans Cash history exploitable : trades valides, P&L brut.
    return { assigned: 0, expected: 0, reconciled: false, merged: false, count: trades.length };
  }

  const feeByFill = new Map<string, number>();
  let missing = 0;
  const fillIds = new Set<string>();
  for (const t of trades) {
    if (t._buyFillId) fillIds.add(t._buyFillId);
    if (t._sellFillId) fillIds.add(t._sellFillId);
  }
  let expected = 0;
  for (const id of fillIds) {
    const fee = fees.get(Number(id));
    if (!fee) {
      missing++;
      continue;
    }
    const amount = totalFillFee(fee);
    feeByFill.set(id, amount);
    expected += amount;
  }
  expected = +expected.toFixed(2);

  const { assigned } = assignFeesOncePerFill(trades, feeByFill);
  return {
    assigned,
    expected,
    // Rapproché = chaque fill des trades a ses frais connus, et tout a été attribué.
    reconciled: missing === 0 && Math.abs(assigned - expected) < 0.01,
    count: trades.length,
  };
}

// Rapprochement « même trade, autre fuseau » (export CSV ↔ API) : règle partagée avec l'import
// CSV, appliquée par `TradesService.importTrades` dans les deux sens (trades/import-dedupe.util.ts).
export { isCrossSourceDuplicate } from '../../trades/import-dedupe.util';
