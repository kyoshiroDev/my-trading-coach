/**
 * Seed du compte DÉMO vitrine en standalone (sans démarrer NestJS).
 * Réutilise la même logique que l'endpoint admin (POST /admin/seed-demo).
 *
 * Lancement : `pnpm seed:demo` (lit apps/api-mytradingcoach/.env).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { seedDemo } from '@api/modules/admin/demo-seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const res = await seedDemo(prisma);
  console.log(`✅ Seed démo terminé : ${res.email}`);
  console.log(`   ${res.trades} trades · WR net ${res.winRate}% · brut ${res.grossPnl} $ · frais ${res.fees} $ · net ${res.pnl} $`);
  console.log(`   ${res.redDays}/${res.tradingDays} jours rouges`);
  console.log(`   ${res.sessions} sessions · ${res.recaps} daily recaps · ${res.debriefs} weekly debriefs`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
