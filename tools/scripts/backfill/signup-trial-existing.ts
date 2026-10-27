/**
 * Relance ponctuelle (#769) : offre l'essai Premium d'inscription (14 jours, sans carte) aux inscrits
 * gratuits qui n'ont JAMAIS eu d'essai ni d'abonnement. À lancer par Greg seulement, s'il le décide.
 *
 * Même effet qu'une inscription d'aujourd'hui (`signupTrialData`) : `trialEndsAt` et
 * `signupTrialEndsAt` à J+14, `trialSource = SIGNUP`, `trialUsed = true` (donc plus d'essai Stripe de
 * 30 jours ensuite). Exclus : démo, rôles autres que USER, Premium, tout essai ou Premium offert passé
 * ou en cours, tout abonnement Stripe passé ou en cours, fondateurs, codes partenaires.
 * Idempotent : un compte traité a `trialUsed = true` et sort de la cible.
 * Sortie : des nombres seulement, jamais d'e-mail ni d'identifiant.
 * Effet visible sous 60 s (cache utilisateur de l'API) ; le rôle Discord n'est pas touché (il suit à
 * la prochaine liaison ou via la resynchronisation admin).
 *
 * Usage : charger l'env (DATABASE_URL) puis
 *   pnpm exec tsx --tsconfig tools/scripts/tsconfig.check.json tools/scripts/backfill/signup-trial-existing.ts --dry-run
 * (sans `--dry-run` : écrit).
 */
import { Plan, Prisma, Role } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { signupTrialData } from '@api/modules/trial/signup-trial';

export const NEVER_TRIALED: Prisma.UserWhereInput = {
  isDemo: false,
  role: Role.USER,
  plan: Plan.FREE,
  trialUsed: false,
  trialEndsAt: null,
  stripeSubscriptionId: null,
  stripeSubscriptionStatus: null,
  founderSeat: { is: null },
  partnerRedemption: { is: null },
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) throw new Error('DATABASE_URL absent, refuse de tourner.');
  console.log(`DB cible : ${url.replace(/(:)[^:@]+(@)/, '$1***$2')}${dryRun ? ' (dry-run, aucune écriture)' : ''}`);

  const prisma = new PrismaService();
  try {
    const count = await prisma.user.count({ where: NEVER_TRIALED });
    console.log(`Inscrits gratuits sans essai : ${count}`);
    if (dryRun || count === 0) return;
    const now = new Date();
    const res = await prisma.user.updateMany({ where: NEVER_TRIALED, data: signupTrialData(now, false) });
    console.log(`Essai posé : ${res.count} compte(s), fin le ${signupTrialData(now, false).trialEndsAt?.toISOString()}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(`Échec : ${err.name}`);
  process.exit(1);
});
