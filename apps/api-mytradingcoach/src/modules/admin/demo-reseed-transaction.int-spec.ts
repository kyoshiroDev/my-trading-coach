/**
 * Re-seed du compte démo sur une vraie base (B6 #1066) : purge et recréation passent dans une
 * transaction, donc un visiteur qui lit la démo pendant le re-seed voit toujours l'ancienne, jamais
 * une démo vide. Le test unitaire ne prouve que le câblage ; ici, la vraie transaction (adapter pg,
 * délai) et ce que voit une lecture concurrente.
 *
 * Mesuré sur banc local avant ce test : sans transaction, un lecteur voit 0 trade pendant la purge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { DemoSeedService } from './demo-seed.service';
import { DEMO_EMAIL } from './demo-seed';

let app: INestApplication;
let prisma: PrismaService;
let demoSeed: DemoSeedService;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  demoSeed = app.get(DemoSeedService);
}, 120_000);

afterAll(async () => {
  // Trade et TradeSession sont en SetNull : supprimés explicitement avant le compte.
  const demo = await prisma?.user.findUnique({ where: { email: DEMO_EMAIL }, select: { id: true } });
  if (demo) {
    await prisma.trade.deleteMany({ where: { userId: demo.id } });
    await prisma.tradeSession.deleteMany({ where: { userId: demo.id } });
    await prisma.tradingAccount.deleteMany({ where: { userId: demo.id } });
    await prisma.user.delete({ where: { id: demo.id } });
  }
  await app?.close();
});

describe('Re-seed démo en transaction, sur une vraie base (B6 #1066)', () => {
  it('une lecture concurrente ne voit jamais la démo vide', async () => {
    await demoSeed.run('int-spec : 1er seed');
    const demo = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL }, select: { id: true } });
    const before = await prisma.trade.count({ where: { userId: demo.id } });
    expect(before).toBeGreaterThan(0);

    let min = Infinity;
    let reads = 0;
    let done = false;
    const poll = (async () => {
      while (!done) {
        min = Math.min(min, await prisma.trade.count({ where: { userId: demo.id } }));
        reads++;
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    await demoSeed.run('int-spec : re-seed');
    done = true;
    await poll;

    expect(reads).toBeGreaterThan(5); // la boucle a bien lu pendant le re-seed
    expect(min).toBeGreaterThan(0);
    expect(await prisma.trade.count({ where: { userId: demo.id } })).toBe(before); // remplacé, pas empilé
  }, 120_000);
});
