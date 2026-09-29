import type { EcoEvent } from '@mtc/shared';
import { todayParis } from '@mtc/shared';
import type { PrismaService } from '@api/prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';

/**
 * Sélection quotidienne d'événements épinglés par l'utilisateur, et ses actifs les plus tradés.
 * Si la date stockée n'est pas aujourd'hui (Paris), la sélection a expiré → reset paresseux.
 */
export async function readUserPins(prisma: PrismaService, userId: string): Promise<string[]> {
  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinnedEcoEvents: true, pinnedEcoDate: true },
  });
  if (!profile) return [];

  // Sélection quotidienne : si la date stockée n'est pas aujourd'hui (Paris),
  // la sélection a expiré → reset paresseux (nettoyage best-effort) + vide.
  if (profile.pinnedEcoDate !== todayParis()) {
    if (profile.pinnedEcoEvents.length > 0 || profile.pinnedEcoDate) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { pinnedEcoEvents: [], pinnedEcoDate: null },
        });
      } catch { /* nettoyage best-effort */ }
    }
    return [];
  }
  return profile.pinnedEcoEvents;
}

export async function saveUserPins(
  prisma: PrismaService,
  redis: RedisService['client'],
  userId: string,
  pins: string[],
): Promise<string[]> {
  await prisma.user.update({
    where: { id: userId },
    data: { pinnedEcoEvents: pins, pinnedEcoDate: todayParis() },
  });
  // Invalider le cache du jour pour que le dashboard voit le nouvel ordre
  const today = todayParis();
  try {
    await redis.del(`eco:calendar:${today}:${userId}`);
  } catch { /* Redis indisponible */ }
  return pins;
}

/** Épinglés d'abord, puis par heure. */
export function sortWithPins(events: EcoEvent[], pins: string[]): EcoEvent[] {
  if (pins.length === 0) return events;
  return [...events].sort((a, b) => {
    const aPinned = pins.includes(`${a.name}:${a.currency}`);
    const bPinned = pins.includes(`${b.name}:${b.currency}`);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return a.time.localeCompare(b.time);
  });
}

/** Les 5 actifs les plus tradés sur les 100 derniers trades. */
export async function userTopAssets(prisma: PrismaService, userId: string): Promise<string[]> {
  const trades = await prisma.trade.findMany({
    where: { userId },
    select: { asset: true },
    take: 100,
    orderBy: { tradedAt: 'desc' },
  });

  const count = new Map<string, number>();
  trades.forEach((t) => count.set(t.asset, (count.get(t.asset) ?? 0) + 1));

  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([asset]) => asset);
}
