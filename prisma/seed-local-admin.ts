import { PrismaClient, Plan, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

// Compte admin de test pour le back-office en local uniquement.
// Identifiants : admin-local@test.com / TestPassword123! (même convention que seed-e2e-users.ts).
const databaseUrl = process.env['DATABASE_URL'] ?? '';
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(databaseUrl)) {
  throw new Error('seed-local-admin : DATABASE_URL doit pointer sur une base locale (localhost).');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const password = await argon2.hash('TestPassword123!');
  const data = { password, name: 'Admin Local', role: Role.ADMIN, plan: Plan.PREMIUM, onboardingCompleted: true };

  const admin = await prisma.user.upsert({
    where: { email: 'admin-local@test.com' },
    update: data,
    create: { email: 'admin-local@test.com', ...data },
  });
  console.log(`✓ ADMIN → ${admin.email} (id: ${admin.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
