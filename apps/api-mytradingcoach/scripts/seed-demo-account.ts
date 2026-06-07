/**
 * Seed du compte DÉMO vitrine en standalone (sans démarrer NestJS).
 * Réutilise la même logique que l'endpoint admin (POST /admin/seed-demo).
 *
 * Lancement : DATABASE_URL=... pnpm tsx apps/api-mytradingcoach/scripts/seed-demo-account.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { seedDemo } from '../src/modules/admin/demo-seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const res = await seedDemo(prisma);
  console.log(`✅ Seed démo terminé : ${res.email}`);
  console.log(`   ${res.trades} trades · WR ${res.winRate}% · P&L +$${res.pnl}`);
  console.log(`   ${res.sessions} sessions · ${res.recaps} daily recaps · ${res.debriefs} weekly debriefs`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
