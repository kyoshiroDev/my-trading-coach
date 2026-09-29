/**
 * Backfill one-shot, idempotent : garantit un `referralCode` à tout utilisateur
 * `role === AMBASSADOR` qui n'en a pas (cas VAL).
 *
 * Un ambassadeur sans code produit un lien `?ref=` invalide, et la liste admin
 * l'affiche avec un code vide (`a.referralCode!`). Le rôle a pu être posé sans
 * passer par `promote()` — seul endroit qui générait le code jusqu'ici.
 *
 * Réutilise `AmbassadorService.promote()` : même génération, même contrôle
 * d'unicité, et n'écrase JAMAIS un code existant (promote() réutilise le code
 * présent). Sûr en prod (ajout seul), relançable sans effet.
 *
 * Usage : charger l'env (DATABASE_URL) puis
 *   pnpm exec tsx --tsconfig tools/scripts/tsconfig.check.json tools/scripts/backfill/ambassador-codes.ts
 */
import { Role } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { AmbassadorService } from '@api/modules/ambassador/ambassador.service';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? '';
  if (!url) throw new Error('DATABASE_URL absent, refuse de tourner.');
  console.log(`DB cible : ${url.replace(/(:)[^:@]+(@)/, '$1***$2')}`);

  const prisma = new PrismaService();
  const ambassador = new AmbassadorService(prisma);

  const targets = await prisma.user.findMany({
    where: { role: Role.AMBASSADOR, referralCode: null },
    select: { id: true, email: true, name: true },
  });

  console.log(`Ambassadeurs sans code : ${targets.length}`);

  const generated: { email: string; code: string }[] = [];
  for (const u of targets) {
    const res = await ambassador.promote(u.email);
    generated.push({ email: res.email, code: res.referralCode });
    console.log(`  ${res.email} → ${res.referralCode}`);
  }

  // Vérifications de sortie : l'invariant doit tenir après passage.
  const remaining = await prisma.user.count({
    where: { role: Role.AMBASSADOR, referralCode: null },
  });
  const dupes = await prisma.$queryRawUnsafe<{ referralCode: string; n: bigint }[]>(
    `select "referralCode", count(*) as n from "User" where "referralCode" is not null group by "referralCode" having count(*) > 1`,
  );

  console.log(`\nGénérés : ${generated.length} | restants sans code : ${remaining} | doublons : ${dupes.length}`);

  await prisma.$disconnect();

  if (remaining > 0) {
    throw new Error(`${remaining} ambassadeur(s) encore sans code : échec du backfill.`);
  }
  if (dupes.length > 0) {
    throw new Error(`Doublons de referralCode détectés : ${dupes.map((d) => d.referralCode).join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
