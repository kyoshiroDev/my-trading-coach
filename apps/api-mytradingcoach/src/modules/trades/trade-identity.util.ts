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
