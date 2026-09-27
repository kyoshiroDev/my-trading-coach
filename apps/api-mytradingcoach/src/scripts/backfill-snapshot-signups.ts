/**
 * Backfill idempotent : recalcule `MetricsSnapshot.newThisDay` pour toutes les
 * lignes existantes, à partir de la date d'inscription réelle.
 *
 * Pourquoi : jusqu'ici le cron de 00h05 comptait les inscrits des 24 h glissantes
 * et rangeait le résultat sous le jour où il tournait. Une inscription du 07/08 à
 * 20h51 se retrouvait donc sous « 08/08 ». Le graphe admin décalait tout d'un jour.
 * Le cron est corrigé, mais l'historique déjà écrit reste faux : ce script le
 * réaligne sur la source de vérité.
 *
 * Sources comptées, pour ne perdre personne :
 *  - `User.createdAt`            → comptes encore actifs
 *  - `DeletedAccount.signedUpAt` → comptes supprimés depuis (sinon on sous-compte
 *                                  les jours dont un inscrit a fermé son compte)
 *
 * Limite connue : `DeletedAccount` ne conserve ni `isDemo` ni `role`, on ne peut
 * donc pas exclure un compte démo/admin supprimé. Négligeable (ils ne sont pas
 * supprimés en pratique), mais à savoir.
 *
 * Usage : charger l'env (DATABASE_URL) puis
 *   node_modules/.bin/tsx apps/api-mytradingcoach/src/scripts/backfill-snapshot-signups.ts [--dry-run]
 */
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parisDayRange } from '@mtc/shared';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) throw new Error('DATABASE_URL absent, refuse de tourner.');
  console.log(`DB cible : ${url.replace(/(:)[^:@]+(@)/, '$1***$2')}${dryRun ? ' — DRY RUN' : ''}`);

  const prisma = new PrismaService();
  const snapshots = await prisma.metricsSnapshot.findMany({
    orderBy: { date: 'asc' },
    select: { date: true, newThisDay: true },
  });
  console.log(`Snapshots à vérifier : ${snapshots.length}\n`);

  let changed = 0;
  for (const snap of snapshots) {
    const { start, end } = parisDayRange(snap.date);

    const [live, deleted] = await Promise.all([
      prisma.user.count({
        where: {
          isDemo: false,
          role: { not: Role.ADMIN },
          createdAt: { gte: start, lt: end },
        },
      }),
      prisma.deletedAccount.count({ where: { signedUpAt: { gte: start, lt: end } } }),
    ]);
    const real = live + deleted;

    if (real === snap.newThisDay) continue;

    console.log(`  ${snap.date} : ${snap.newThisDay} → ${real}`);
    changed++;
    if (!dryRun) {
      await prisma.metricsSnapshot.update({
        where: { date: snap.date },
        data: { newThisDay: real },
      });
    }
  }

  // Contrôle de cohérence : la somme des barres doit égaler le nombre d'inscrits
  // sur la fenêtre couverte par les snapshots.
  if (snapshots.length > 0) {
    const first = snapshots[0].date;
    const last = snapshots[snapshots.length - 1].date;
    const { start } = parisDayRange(first);
    const { end } = parisDayRange(last);

    const [sum, live, deleted] = await Promise.all([
      prisma.metricsSnapshot.aggregate({
        _sum: { newThisDay: true },
        where: { date: { gte: first, lte: last } },
      }),
      prisma.user.count({
        where: { isDemo: false, role: { not: Role.ADMIN }, createdAt: { gte: start, lt: end } },
      }),
      prisma.deletedAccount.count({ where: { signedUpAt: { gte: start, lt: end } } }),
    ]);

    const barres = sum._sum.newThisDay ?? 0;
    const attendu = live + deleted;
    console.log(
      `\nFenêtre ${first} → ${last} | somme des barres : ${barres} | inscrits réels : ${attendu}` +
        (barres === attendu ? ' ✅' : ' ⚠️ écart'),
    );
  }

  console.log(`\nLignes ${dryRun ? 'à corriger' : 'corrigées'} : ${changed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
