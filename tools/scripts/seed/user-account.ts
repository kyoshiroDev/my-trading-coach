/**
 * Remplit un compte de TEST existant avec le jeu de données du compte démo (sans démarrer NestJS) :
 * ses comptes de trading, ~6 semaines de trades, sessions, récaps, débriefs hebdo.
 *
 * Usage : `pnpm seed:user <email> [--beta-tester] [--force]`
 *   --beta-tester : rôle BETA_TESTER (accès Premium sans toucher au plan ni à Stripe).
 *   --force       : accepte un compte qui a déjà des trades (ils sont PURGÉS).
 *
 * Garde-fous : base beta ou locale uniquement (jamais la prod), compte existant et non démo.
 */
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { seedTradingData } from '@api/modules/admin/demo-seed';

const url = process.env['DATABASE_URL'] ?? '';
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const betaTester = args.includes('--beta-tester');
const force = args.includes('--force');

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!email) fail('Usage : pnpm seed:user <email> [--beta-tester] [--force]');
if (/mytradingcoach_prod/.test(url)) fail('Base PROD refusée.');
if (!/mytradingcoach_beta|localhost|127\.0\.0\.1/.test(url)) fail('Base non reconnue : beta ou locale uniquement.');

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, isDemo: true, role: true } });
  if (!user) fail(`Aucun compte ${email} dans cette base.`);
  if (user.isDemo) fail('Compte démo : utiliser pnpm seed:demo.');
  const existing = await prisma.trade.count({ where: { userId: user.id } });
  if (existing > 0 && !force) fail(`${existing} trades existants (seraient purgés). Relancer avec --force si c'est voulu.`);

  const res = await seedTradingData(prisma, user);
  if (betaTester && user.role === Role.USER) {
    await prisma.user.update({ where: { id: user.id }, data: { role: Role.BETA_TESTER } });
  }
  console.log(`✅ ${res.email} alimenté : ${res.trades} trades · ${res.sessions} sessions · ${res.recaps} récaps · ${res.debriefs} débriefs`);
  if (betaTester) console.log('   Rôle BETA_TESTER (accès Premium).');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
