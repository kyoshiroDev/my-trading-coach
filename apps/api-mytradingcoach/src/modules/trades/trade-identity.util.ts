/** Identité d'un trade pour l'import et la détection de doublons (fonctions pures). */
import { roundCents } from '@mtc/shared';
import type { CreateTradeDto } from './dto/create-trade.dto';

/**
 * Trade d'un lot d'import. Une position Tradovate regroupée (#956) porte sa clé stable
 * `_positionKey` (`tv:<fill d'ouverture>`) et ses paires d'origine `_pairs`.
 */
export type ImportTradeInput = Partial<CreateTradeDto> & {
  _positionKey?: string;
  _pairs?: Partial<CreateTradeDto>[];
};


/**
 * Empreinte de la n-ième occurrence d'un même trade dans une source (fichier, synchro) : la 1ʳᵉ
 * garde la clé, les suivantes prennent `#n`. Réimporter la même source redonne les mêmes
 * numéros → aucun doublon ; une répétition absente de la base est, elle, bien créée.
 */
export function occurrenceHash(key: string, n: number): string {
  return n === 1 ? key : `${key}#${n}`;
}

/**
 * Clé d'unicité d'un trade : asset + side + tradedAt + entry + exit + pnl. Le P&L y entre AU CENTIME
 * (`roundCents`, B1 #981) : le P&L stocké est arrondi depuis B1, les trades importés avant gardent leur
 * valeur brute (12,3456789) et doivent garder la même clé que le même trade arrondi (12,35). Un P&L
 * déjà au centime donne la même clé qu'avant : les empreintes existantes restent valides.
 */
export function dedupeKey(t: {
  asset?: string | null;
  side?: string | null;
  tradedAt?: string | Date | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
}): string {
  const at = t.tradedAt ? new Date(t.tradedAt).toISOString() : '';
  const pnl = t.pnl == null || !Number.isFinite(t.pnl) ? (t.pnl ?? '') : roundCents(t.pnl);
  return [t.asset ?? '', t.side ?? '', at, t.entry ?? '', t.exit ?? '', pnl].join('|');
}

/**
 * Identité d'un trade pour la détection de doublons : son empreinte d'import si elle existe
 * (une répétition légitime porte `#2`, `#3`… et n'est donc JAMAIS un doublon), sinon la clé
 * recalculée (trades saisis à la main ou importés avant la migration `importHash`).
 */
export function duplicateIdentity(t: {
  asset?: string | null;
  side?: string | null;
  tradedAt?: string | Date | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
  importHash?: string | null;
}): string {
  return t.importHash ?? dedupeKey(t);
}

/**
 * Trades déjà en base dont le `pnl` a été stocké NET des frais (ancien parseur MEXC, avant #947 :
 * le « Realized PNL » net allait dans `pnl`). Le parseur sort maintenant le BRUT (net + frais) :
 * la clé de dédoublonnage (qui contient le pnl) ne reconnaît plus ces trades, et ré-importer le même
 * fichier les recréerait. Rapprochement un-pour-un : mêmes actif, sens, date, entrée et sortie, et
 * `pnl en base ≈ pnl − frais` du trade importé (au centime). Ne sert qu'aux lignes avec frais.
 */
export class LegacyNetPnlPool {
  private readonly byKey = new Map<string, number[]>();

  constructor(existing: Iterable<{ asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null }>) {
    for (const t of existing) {
      if (t.pnl == null) continue;
      const k = LegacyNetPnlPool.key(t);
      this.byKey.set(k, [...(this.byKey.get(k) ?? []), t.pnl]);
    }
  }

  private static key(t: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null }) {
    return dedupeKey({ ...t, pnl: null });
  }

  /** Vrai (et consommé) si le trade importé correspond à un trade stocké à l'ancien format. */
  take(dto: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null; commission?: number | null }): boolean {
    const { list, i } = this.find(dto);
    if (!list || i < 0) return false;
    list.splice(i, 1);
    return true;
  }

  /** Comme `take`, sans rien consommer (regroupement par position, #956). */
  has(dto: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null; commission?: number | null }): boolean {
    return this.find(dto).i >= 0;
  }

  private find(dto: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null; commission?: number | null }): { list?: number[]; i: number } {
    const fee = Math.abs(dto.commission ?? 0);
    if (dto.pnl == null || fee === 0) return { i: -1 };
    const list = this.byKey.get(LegacyNetPnlPool.key(dto));
    return { list, i: list?.findIndex((p) => Math.abs(p - (dto.pnl! - fee)) < 0.01) ?? -1 };
  }
}

/**
 * Trades déjà en base dont le `pnl` a été arrondi par l'ancienne règle `toFixed(2)` (mapper
 * Tradovate, `calculatePnl`, avant B1 #981). `toFixed` arrondit la valeur BINAIRE : sur un
 * demi-centime, il donne 1 centime de moins que `roundCents` (39,845 → 39,84 contre 39,85). L'empreinte
 * d'import de ces trades porte l'ancien P&L : sans ce rapprochement, le ré-import les recréerait.
 * Un pour un : mêmes actif, sens, date, entrée et sortie, et P&L à exactement 1 centime près une fois
 * arrondis. Un P&L IDENTIQUE au centime n'est jamais pris ici : c'est la clé exacte qui compte les
 * répétitions légitimes (plusieurs paires d'un même trade).
 */
export class CentRoundingPool {
  private readonly byKey = new Map<string, number[]>();

  constructor(existing: Iterable<{ asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null }>) {
    for (const t of existing) {
      if (t.pnl == null || !Number.isFinite(t.pnl)) continue;
      const k = dedupeKey({ ...t, pnl: null });
      this.byKey.set(k, [...(this.byKey.get(k) ?? []), roundCents(t.pnl)]);
    }
  }

  /** Vrai (et consommé) si un trade en base ne diffère du trade importé que d'1 centime d'arrondi. */
  take(dto: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null }): boolean {
    const { list, i } = this.find(dto);
    if (!list || i < 0) return false;
    list.splice(i, 1);
    return true;
  }

  /** Comme `take`, sans rien consommer (regroupement par position, #956). */
  has(dto: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null }): boolean {
    return this.find(dto).i >= 0;
  }

  private find(dto: { asset?: string | null; side?: string | null; tradedAt?: string | Date | null; entry?: number | null; exit?: number | null; pnl?: number | null }): { list?: number[]; i: number } {
    if (dto.pnl == null || !Number.isFinite(dto.pnl)) return { i: -1 };
    const list = this.byKey.get(dedupeKey({ ...dto, pnl: null }));
    const p = roundCents(dto.pnl);
    return { list, i: list?.findIndex((x) => Math.abs(Math.abs(x - p) - 0.01) < 0.001) ?? -1 };
  }
}

/**
 * Retire les métadonnées internes d'un trade importé (`_buyFillId`, `_positionKey`, `_pairs`…) :
 * jamais persistées (Prisma refuserait un champ inconnu).
 */
export function withoutImportMeta<T extends object>(dto: T): T {
  return Object.fromEntries(Object.entries(dto).filter(([k]) => !k.startsWith('_'))) as T;
}
