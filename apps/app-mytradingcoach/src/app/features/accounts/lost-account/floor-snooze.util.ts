/**
 * « Pas maintenant » sur le bandeau « Plancher atteint » : le bandeau de CE compte disparaît 24 h
 * (stockage local du navigateur). Fonctions pures autour d'un stockage injecté, testées seules.
 */

export const FLOOR_SNOOZE_KEY = 'mtc.floorSnooze';
export const FLOOR_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** id du compte → fin du masquage (ms depuis l'époque). */
export type FloorSnoozes = Record<string, number>;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Masquages encore valides ; un stockage illisible ou absent vaut « aucun ». */
export function readSnoozes(storage: Store | null, now: number): FloorSnoozes {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(FLOOR_SNOOZE_KEY) ?? null;
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, number] => typeof e[1] === 'number' && e[1] > now,
      ),
    );
  } catch {
    return {};
  }
}

/** Masque le bandeau du compte pour 24 h ; renvoie les masquages à jour (expirés retirés). */
export function snoozeFloor(storage: Store | null, accountId: string, now: number): FloorSnoozes {
  const next = { ...readSnoozes(storage, now), [accountId]: now + FLOOR_SNOOZE_MS };
  try {
    storage?.setItem(FLOOR_SNOOZE_KEY, JSON.stringify(next));
  } catch {
    /* stockage plein ou indisponible : le masquage vaut pour la page ouverte */
  }
  return next;
}

/** Comptes dont le bandeau s'affiche : plancher estimé atteint et pas masqué. */
export function floorBannerAccounts<T extends { id: string; floorReached?: boolean }>(
  accounts: readonly T[],
  snoozes: FloorSnoozes,
  now: number,
): T[] {
  return accounts.filter((a) => a.floorReached === true && !((snoozes[a.id] ?? 0) > now));
}
