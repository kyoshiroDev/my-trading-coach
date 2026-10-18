/**
 * Clôture ponctuelle de sessions restées ouvertes, PAR ID, avec la logique de `SessionCloseCron`
 * (`autoCloseData` : fin de leur journée de trading, totaux sur leurs seuls trades). #595.
 *
 * Sans `--apply` : lecture seule, affiche ce qui serait écrit. Refuse une session qui n'est pas
 * ACTIVE ou qui appartient à la journée de trading en cours.
 *
 * Exécution dans le conteneur API (DATABASE_URL déjà présent) :
 *   pnpm exec esbuild apps/api-mytradingcoach/scripts/close-sessions.ts --bundle --platform=node \
 *     --tsconfig=apps/api-mytradingcoach/tsconfig.app.json \
 *     --external:@prisma/client --external:@prisma/adapter-pg --external:pg --outfile=close-sessions.js
 *   docker cp close-sessions.js <conteneur>:/app/ && docker exec <conteneur> node /app/close-sessions.js <id…> [--apply]
 */
import { PrismaClient, SessionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { tradingDayStart } from '../src/modules/session/active-session';
import { autoCloseData } from '../src/modules/session/session-totals';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ids = args.filter((a) => !a.startsWith('--'));
  if (ids.length === 0) throw new Error('Usage : close-sessions <sessionId…> [--apply]');

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as ConstructorParameters<typeof PrismaClient>[0]);
  const dayStart = tradingDayStart(new Date());

  try {
    for (const id of ids) {
      const s = await prisma.tradeSession.findUnique({
        where: { id },
        select: { id: true, userId: true, accountId: true, status: true, startedAt: true, user: { select: { role: true, isDemo: true } } },
      });
      if (!s) { console.log(JSON.stringify({ id, error: 'introuvable' })); continue; }
      if (s.status !== SessionStatus.ACTIVE || s.startedAt >= dayStart) {
        console.log(JSON.stringify({ id, error: 'pas une session ouverte d’une journée précédente', status: s.status, startedAt: s.startedAt }));
        continue;
      }
      // Même lecture que SessionService.sessionTrades
      const trades = await prisma.trade.findMany({
        where: { userId: s.userId, sessionId: s.id, ...(s.accountId ? { accountId: s.accountId } : {}) },
        select: { pnl: true, commission: true, asset: true },
        orderBy: { tradedAt: 'asc' },
      });
      const data = autoCloseData(s.startedAt, trades);
      const preview = {
        id: s.id, owner: { userId: s.userId, role: s.user.role, isDemo: s.user.isDemo },
        startedAt: s.startedAt, tradesAttached: trades.length, write: data,
      };
      if (!apply) { console.log(JSON.stringify({ mode: 'dry-run', ...preview })); continue; }

      const { count } = await prisma.tradeSession.updateMany({ where: { id: s.id, status: SessionStatus.ACTIVE }, data });
      const after = await prisma.tradeSession.findUnique({
        where: { id: s.id },
        select: { status: true, endedAt: true, totalPnl: true, totalTrades: true, winRate: true, maxDrawdown: true, bestTradePnl: true, bestTradeAsset: true },
      });
      console.log(JSON.stringify({ mode: 'apply', id: s.id, updated: count, after }));
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
