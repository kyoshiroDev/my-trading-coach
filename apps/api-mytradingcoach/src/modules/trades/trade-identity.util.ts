/** Identité d'un trade pour l'import et la détection de doublons (fonctions pures). */


/**
 * Empreinte de la n-ième occurrence d'un même trade dans une source (fichier, synchro) : la 1ʳᵉ
 * garde la clé, les suivantes prennent `#n`. Réimporter la même source redonne les mêmes
 * numéros → aucun doublon ; une répétition absente de la base est, elle, bien créée.
 */
export function occurrenceHash(key: string, n: number): string {
  return n === 1 ? key : `${key}#${n}`;
}

/** Clé d'unicité d'un trade : asset + side + tradedAt + entry + exit + pnl. */
export function dedupeKey(t: {
  asset?: string | null;
  side?: string | null;
  tradedAt?: string | Date | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
}): string {
  const at = t.tradedAt ? new Date(t.tradedAt).toISOString() : '';
  return [t.asset ?? '', t.side ?? '', at, t.entry ?? '', t.exit ?? '', t.pnl ?? ''].join('|');
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
    const fee = Math.abs(dto.commission ?? 0);
    if (dto.pnl == null || fee === 0) return false;
    const list = this.byKey.get(LegacyNetPnlPool.key(dto));
    const i = list?.findIndex((p) => Math.abs(p - (dto.pnl! - fee)) < 0.01) ?? -1;
    if (!list || i < 0) return false;
    list.splice(i, 1);
    return true;
  }
}
