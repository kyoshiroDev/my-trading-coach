/**
 * Backfill one-shot, idempotent : donne un `referralCode` a chaque user non-demo
 * qui n'en a pas, en REUTILISANT la generation existante (ReferralService.ensureReferralCode
 * → meme format, meme garantie d'unicite). N'ECRASE jamais un code existant (ensureReferralCode
 * retourne le code present sans regenerer). Sur en prod (ajout seul). Relancable sans effet.
 *
 * Usage : charger l'env (DATABASE_URL) puis :
 *   node_modules/.bin/tsx apps/api-mytradingcoach/src/scripts/backfill-referral-codes.ts
 */
import { PrismaService } from '../prisma/prisma.service';
import { ReferralService } from '../modules/referral/referral.service';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) throw new Error('DATABASE_URL absent, refuse de tourner.');
  // Garde-fou : refuser une URL qui ressemble a la prod (heuristique simple, a confirmer a la main).
  if (/prod|production/i.test(url)) {
    throw new Error('DATABASE_URL semble pointer vers la prod, execution refusee.');
  }
  console.log(`DB cible : ${url.replace(/(:)[^:@]+(@)/, '$1***$2')}`);

  const prisma = new PrismaService();
  // ensureReferralCode n'utilise que `prisma` ; resend/stripe non sollicites ici.
  const referral = new ReferralService(prisma as never, {} as never, {} as never);

  const before = await prisma.user.count({ where: { isDemo: false, referralCode: null } });
  const targets = await prisma.user.findMany({
    where: { isDemo: false, referralCode: null },
    select: { id: true },
  });

  let generated = 0;
  for (const u of targets) {
    await referral.ensureReferralCode(u.id);
    generated++;
  }

  const remaining = await prisma.user.count({ where: { isDemo: false, referralCode: null } });
  const dupes = await prisma.$queryRawUnsafe<{ referralCode: string; n: bigint }[]>(
    `select "referralCode", count(*) as n from "User" where "referralCode" is not null group by "referralCode" having count(*) > 1`,
  );
  const totalNonDemo = await prisma.user.count({ where: { isDemo: false } });
  const withCode = await prisma.user.count({ where: { isDemo: false, referralCode: { not: null } } });

  console.log(
    JSON.stringify(
      {
        nonDemoUsers: totalNonDemo,
        withCodeBefore: totalNonDemo - before,
        targeted: targets.length,
        generated,
        withCodeAfter: withCode,
        remainingWithoutCode: remaining,
        duplicateCodes: dupes.length,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  if (remaining > 0 || dupes.length > 0) {
    throw new Error(`Backfill incomplet (restants: ${remaining}, doublons: ${dupes.length}).`);
  }
}

main().catch((err) => {
  console.error('Backfill echoue :', err);
  process.exit(1);
});
