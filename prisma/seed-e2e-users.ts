import { PrismaClient, Plan } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  const password = await argon2.hash('TestPassword123!');

  const free = await prisma.user.upsert({
    where: { email: 'free-e2e@test.com' },
    update: { password, name: 'Free E2E', plan: Plan.FREE, onboardingCompleted: true },
    create: { email: 'free-e2e@test.com', password, name: 'Free E2E', plan: Plan.FREE, onboardingCompleted: true },
  });
  console.log(`✓ FREE  → ${free.email} (id: ${free.id})`);

  const premium = await prisma.user.upsert({
    where: { email: 'premium-e2e@test.com' },
    update: { password, name: 'Premium E2E', plan: Plan.PREMIUM, onboardingCompleted: true },
    create: { email: 'premium-e2e@test.com', password, name: 'Premium E2E', plan: Plan.PREMIUM, onboardingCompleted: true },
  });
  console.log(`✓ PREMIUM → ${premium.email} (id: ${premium.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
