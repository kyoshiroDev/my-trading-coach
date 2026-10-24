import type { PrismaClient } from '@prisma/client';

/**
 * Notifications push du compte démo (#666, revue phase 2 m9) : deux appareils et des heures
 * silencieuses de 22:00 à 07:00, pour que la section du profil montre un réglage réaliste.
 *
 * Adresses factices (aucune clé réelle) : rien n'est jamais envoyé, le notifieur écarte les
 * comptes démo avant tout envoi. Module pur (seed lancé sous tsx).
 */
export const DEMO_PUSH_DEVICES = [
  {
    endpoint: 'https://fcm.googleapis.com/fcm/send/mtc-demo-android',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    daysAgo: 9,
  },
  {
    endpoint: 'https://fcm.googleapis.com/fcm/send/mtc-demo-windows',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    daysAgo: 23,
  },
] as const;

/** Minutes depuis minuit, heure de Paris. */
export const DEMO_QUIET_HOURS = { start: 22 * 60, end: 7 * 60 } as const;

export async function seedDemoPush(prisma: PrismaClient, userId: string, now: Date): Promise<number> {
  await prisma.userPushDevice.deleteMany({ where: { userId } });
  await prisma.userPushDevice.createMany({
    data: DEMO_PUSH_DEVICES.map((d) => ({
      userId,
      endpoint: d.endpoint,
      p256dh: 'B'.repeat(87),
      auth: 'a'.repeat(22),
      userAgent: d.userAgent,
      createdAt: new Date(now.getTime() - d.daysAgo * 86_400_000),
    })),
  });
  const quiet = { quietStart: DEMO_QUIET_HOURS.start, quietEnd: DEMO_QUIET_HOURS.end };
  await prisma.traderPushPreference.upsert({
    where: { userId },
    create: { userId, ...quiet },
    update: quiet,
  });
  return DEMO_PUSH_DEVICES.length;
}
