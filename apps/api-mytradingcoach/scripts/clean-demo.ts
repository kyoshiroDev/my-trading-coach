import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_EMAIL = 'tahir.gregory.dev@gmail.com';

async function main() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error(`User introuvable : ${TARGET_EMAIL}`);

  const result = await prisma.trade.deleteMany({
    where: { userId: user.id, tags: { has: 'DEMO_SEED' } },
  });
  console.log(`🗑️  ${result.count} trades de démo supprimés.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
