/**
 * Rapprochement « même trade, autre fuseau » partagé par l'import CSV et la synchro broker :
 * appliqué par `TradesService.importTrades`, dans les deux sens (CSV avant ou après la
 * synchro). Pur, sans I/O.
 */

/** Champs qui identifient un trade (la quantité est portée par le P&L). */
export interface TradeIdentity {
  asset?: string | null;
  side?: string | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
  tradedAt?: string | Date | null;
}

const HALF_HOUR_MS = 30 * 60 * 1000;
const MAX_TZ_OFFSET_MS = 14 * 60 * 60 * 1000;

/**
 * Le trade importé existe-t-il déjà, daté dans un autre fuseau ?
 *
 * L'empreinte exacte (`importHash`) ne suffit pas : l'export Performance de Tradovate donne des
 * heures LOCALES sans fuseau (`07/10/2026 15:34:00`), que le serveur interprète dans SON fuseau,
 * alors que l'API donne l'UTC réel. Le même trade diffère donc d'un décalage horaire entier (ou
 * d'une demi-heure pour certains fuseaux) — et de rien d'autre : mêmes prix, même P&L, mêmes
 * minutes et secondes. On reconnaît ce cas précis, borné à ±14 h.
 *
 * Écart nul exclu : à la même heure exacte l'empreinte coïncide, et c'est `importTrades` qui
 * tranche en comptant les répétitions. L'accepter ici faisait absorber par UN trade existant
 * toutes les paires identiques d'un trade à plusieurs contrats.
 */
export function isCrossSourceDuplicate(dto: TradeIdentity, existing: TradeIdentity[]): boolean {
  if (!dto.tradedAt) return false;
  const at = new Date(dto.tradedAt).getTime();
  return existing.some((e) => {
    if (!e.tradedAt) return false;
    if (e.asset !== dto.asset || e.side !== dto.side) return false;
    if (e.entry !== dto.entry || (e.exit ?? null) !== (dto.exit ?? null)) return false;
    if (e.pnl == null || dto.pnl == null || Math.abs(e.pnl - dto.pnl) >= 0.005) return false;
    const delta = Math.abs(new Date(e.tradedAt).getTime() - at);
    return delta > 0 && delta <= MAX_TZ_OFFSET_MS && delta % HALF_HOUR_MS === 0;
  });
}

/**
 * Trades existants disponibles pour ce rapprochement, UN-POUR-UN : chacun n'absorbe qu'une ligne
 * importée (4 lignes identiques face à 1 trade existant → 3 restent à importer). Indexés par
 * actif / sens / prix pour ne comparer que les candidats plausibles.
 */
export class CrossSourcePool {
  private readonly byPrice = new Map<string, TradeIdentity[]>();

  constructor(existing: TradeIdentity[]) {
    for (const e of existing) {
      const k = CrossSourcePool.bucket(e);
      let list = this.byPrice.get(k);
      if (!list) {
        list = [];
        this.byPrice.set(k, list);
      }
      list.push(e);
    }
  }

  private static bucket(t: TradeIdentity): string {
    return [t.asset ?? '', t.side ?? '', t.entry ?? '', t.exit ?? ''].join('|');
  }

  /** Retire le trade existant qui correspond à `dto` dans un autre fuseau ; `true` s'il y en a un. */
  take(dto: TradeIdentity): boolean {
    const list = this.byPrice.get(CrossSourcePool.bucket(dto));
    if (!list) return false;
    const i = list.findIndex((e) => isCrossSourceDuplicate(dto, [e]));
    if (i === -1) return false;
    list.splice(i, 1);
    return true;
  }
}
