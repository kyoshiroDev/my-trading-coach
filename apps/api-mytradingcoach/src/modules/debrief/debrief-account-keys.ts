/**
 * Débrief de la semaine : les comptes de trading sont désignés à l'IA par une clé courte
 * (`compte-1`, `compte-2`…), jamais par leur identifiant interne. Fonctions PURES.
 *
 * L'IA renvoie la clé dans son analyse par compte ; `toId` la retraduit pour la fusion. Une clé
 * inconnue (inventée ou mal recopiée par le modèle) donne `null` : son analyse est ignorée.
 */

export const UNASSIGNED = 'unassigned';

export interface AccountKeys {
  /** Clé envoyée à l'IA pour un identifiant de compte (une nouvelle si l'id n'était pas connu). */
  toKey(id: string): string;
  /** Identifiant d'origine d'une clé renvoyée par l'IA, `null` si elle est inconnue. */
  toId(key: string): string | null;
}

/** Clés attribuées dans l'ordre donné (celui des comptes affichés), `unassigned` inchangé. */
export function accountKeys(ids: string[]): AccountKeys {
  const keyOf = new Map<string, string>();
  const idOf = new Map<string, string>();
  const toKey = (id: string) => {
    if (id === UNASSIGNED) return UNASSIGNED;
    let key = keyOf.get(id);
    if (!key) {
      key = `compte-${keyOf.size + 1}`;
      keyOf.set(id, key);
      idOf.set(key, id);
    }
    return key;
  };
  ids.forEach(toKey);
  return {
    toKey,
    toId: (key) => (key === UNASSIGNED ? UNASSIGNED : idOf.get(key) ?? null),
  };
}

/** Trades regroupés par clé, sans leur `accountId` : rien d'interne ne part vers l'IA. */
export function tradesByKey<T extends { accountId?: string | null }>(
  byAccount: Record<string, T[]>,
  keys: AccountKeys,
): Record<string, Omit<T, 'accountId'>[]> {
  return Object.fromEntries(
    Object.entries(byAccount).map(([id, trades]) => [
      keys.toKey(id),
      trades.map(({ accountId: _accountId, ...rest }) => rest),
    ]),
  );
}
