/**
 * Scénarios métier des statistiques, sur le VRAI Postgres (SCA-B2-01).
 *
 * Ces cas vivaient dans analytics.service.spec.ts en simulant `prisma.trade.findMany` : depuis le
 * passage des agrégats en SQL, une simulation ne testerait plus rien. Chaque cas insère ses trades
 * (dans l'ordre donné : identifiants croissants, l'ordre chronologique est sans ambiguïté même à
 * date égale) puis interroge le service réel. Mêmes attentes qu'avant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { EmotionState, TradingSession, TradeSide } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const sid = (name: string) => `${RUN}-${name}`;

interface T {
  pnl: number | null;
  commission?: number | null;
  riskReward?: number | null;
  emotion?: EmotionState | null;
  setupId?: string;
  setup?: { title: string; color: string };
  tradedAt?: Date;
}

const today10h = () => new Date(new Date().setHours(10, 0, 0, 0));
const makeTrade = (pnl: number): T => ({ pnl, riskReward: pnl > 0 ? 2 : null, emotion: EmotionState.CONFIDENT });

let app: INestApplication;
let prisma: PrismaService;
let service: AnalyticsService;
let userId: string;
let seq = 0;

/** Remplace les trades (et setups) de l'utilisateur de test par ceux du scénario. */
async function seed(trades: T[], activeSetups: { id: string; title: string; color: string }[] = []) {
  await prisma.trade.deleteMany({ where: { userId } });
  await prisma.setup.deleteMany({ where: { userId } });
  const setups = new Map<string, { title: string; color: string; archived: boolean }>();
  activeSetups.forEach((s) => setups.set(sid(s.id), { title: s.title, color: s.color, archived: false }));
  for (const t of trades) {
    const id = sid(t.setupId ?? 'setup-breakout');
    if (!setups.has(id)) setups.set(id, { ...(t.setup ?? { title: 'Breakout', color: '#10b981' }), archived: true });
  }
  for (const [id, s] of setups) await prisma.setup.create({ data: { id, userId, ...s } });
  await prisma.trade.createMany({
    data: trades.map((t) => ({
      id: `${RUN}-t-${String(seq++).padStart(6, '0')}`,
      userId,
      asset: 'BTC/USDT',
      side: TradeSide.LONG,
      entry: 50000,
      pnl: t.pnl,
      commission: t.commission ?? null,
      riskReward: t.riskReward ?? null,
      emotion: t.emotion ?? null,
      setupId: sid(t.setupId ?? 'setup-breakout'),
      session: TradingSession.LONDON,
      timeframe: '1H',
      tradedAt: t.tradedAt ?? today10h(),
    })),
  });
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  service = app.get(AnalyticsService);
  userId = (await prisma.user.create({ data: { email: `int-b2-scen-${RUN}@test.local`, password: 'x' } })).id;
}, 120_000);

// Les get* passent par le cache Redis : on le vide pour que chaque scénario recalcule.
beforeEach(async () => {
  if (service) await service.invalidateUserCache(userId);
});

afterAll(async () => {
  if (prisma && userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

describe('getSummary — accessible FREE et PREMIUM', () => {
  it('retourne les propriétés attendues', async () => {
    await seed([makeTrade(100), makeTrade(-50), makeTrade(200)]);
    const result = await service.getSummary(userId);
    for (const k of ['winRate', 'totalPnl', 'totalTrades', 'maxDrawdown', 'streak']) expect(result).toHaveProperty(k);
  });

  it('calcule correctement le win rate', async () => {
    await seed([makeTrade(100), makeTrade(200), makeTrade(-50), makeTrade(-30)]);
    const result = await service.getSummary(userId);
    expect(result.winRate).toBe(50);
    expect(result.totalTrades).toBe(4);
    // profit factor = profits bruts (300) / pertes brutes (80) = 3.75
    expect(result.profitFactor).toBeCloseTo(3.75);
  });

  describe('drawdown maximum', () => {
    it('mesure la plus forte baisse depuis le pic du P&L cumulé', async () => {
      // Cumulé : 100 → 300 → 250 → 60 → 160. Pic 300, creux 60 → drawdown 240.
      await seed([makeTrade(100), makeTrade(200), makeTrade(-50), makeTrade(-190), makeTrade(100)]);
      expect((await service.getSummary(userId)).maxDrawdown).toBe(240);
    });

    it('retient la PLUS FORTE baisse, pas la dernière', async () => {
      // Cumulé : 500 → 200 (−300) → 600 → 500 (−100) : c'est 300 qui doit rester.
      await seed([makeTrade(500), makeTrade(-300), makeTrade(400), makeTrade(-100)]);
      expect((await service.getSummary(userId)).maxDrawdown).toBe(300);
    });

    it('série uniquement gagnante → aucun drawdown', async () => {
      await seed([makeTrade(100), makeTrade(50), makeTrade(75)]);
      expect((await service.getSummary(userId)).maxDrawdown).toBe(0);
    });

    it('compte perdant dès le premier trade → drawdown depuis le pic 0', async () => {
      await seed([makeTrade(-80), makeTrade(-40)]);
      expect((await service.getSummary(userId)).maxDrawdown).toBe(120);
    });
  });

  it("profit factor null quand il n'y a aucune perte (division par zéro évitée)", async () => {
    await seed([makeTrade(100), makeTrade(250)]);
    const result = await service.getSummary(userId);
    expect(result.profitFactor).toBeNull();
    expect(result.winRate).toBe(100);
  });

  it("retourne des zéros s'il n'y a aucun trade", async () => {
    await seed([]);
    const result = await service.getSummary(userId);
    expect(result).toMatchObject({ winRate: 0, totalPnl: 0, totalTrades: 0, maxDrawdown: 0, profitFactor: null, streak: 0 });
  });

  it('calcule correctement le P&L total', async () => {
    await seed([makeTrade(100), makeTrade(-50), makeTrade(200)]);
    expect((await service.getSummary(userId)).totalPnl).toBe(250);
  });

  it('P&L net = pnl brut MOINS les frais (commission)', async () => {
    await seed([{ ...makeTrade(100), commission: 3 }, { ...makeTrade(200), commission: 2 }]);
    expect((await service.getSummary(userId)).totalPnl).toBe(295);
  });

  it('classe gagnant/perdant sur le NET : +1 brut avec 1,90 de frais est une perte', async () => {
    await seed([{ ...makeTrade(1), commission: 1.9 }, { ...makeTrade(100), commission: 2 }]);
    const result = await service.getSummary(userId);
    expect(result.winRate).toBe(50);
    expect(result.totalPnl).toBe(97.1);
    expect(result.maxDrawdown).toBeCloseTo(0.9); // −0,90 dès le 1er trade (net)
  });

  it('calcule le streak positif en cours', async () => {
    await seed([makeTrade(-50), makeTrade(100), makeTrade(200), makeTrade(150)]);
    expect((await service.getSummary(userId)).streak).toBe(3);
  });

  it('streak négatif : un break-even compte comme non gagnant, comme avant', async () => {
    await seed([makeTrade(100), makeTrade(-20), makeTrade(0), makeTrade(-5)]);
    expect((await service.getSummary(userId)).streak).toBe(-3);
  });
});

describe('getByEmotion', () => {
  it('groupe par émotion et calcule win rate', async () => {
    await seed([
      { ...makeTrade(100), emotion: EmotionState.CONFIDENT },
      { ...makeTrade(200), emotion: EmotionState.CONFIDENT },
      { ...makeTrade(-50), emotion: EmotionState.STRESSED },
    ]);
    const confident = (await service.getByEmotion(userId)).find((r) => r.emotion === EmotionState.CONFIDENT);
    expect(confident?.winRate).toBe(100);
    expect(confident?.count).toBe(2);
  });
});

describe('getBySetup', () => {
  it('groupe par setupId, joint title/color et calcule win rate', async () => {
    await seed(
      [
        { ...makeTrade(100), setupId: 'setup-breakout' },
        { ...makeTrade(-50), setupId: 'setup-breakout' },
        { ...makeTrade(200), setupId: 'setup-pullback' },
      ],
      [
        { id: 'setup-breakout', title: 'Breakout', color: '#10b981' },
        { id: 'setup-pullback', title: 'Pullback', color: '#3b82f6' },
      ],
    );
    const breakout = (await service.getBySetup(userId)).find((r) => r.setupId === sid('setup-breakout'));
    expect(breakout?.title).toBe('Breakout');
    expect(breakout?.winRate).toBe(50);
    expect(breakout?.count).toBe(2);
  });

  it('inclut un setup actif sans trade (count 0, winRate null) et un archivé seulement s’il a des trades', async () => {
    await seed(
      [
        { ...makeTrade(100), setupId: 'setup-used' },
        { ...makeTrade(-30), setupId: 'setup-arch', setup: { title: 'Archivé', color: '#ef4444' } },
      ],
      [
        { id: 'setup-active', title: 'Actif', color: '#10b981' },
        { id: 'setup-used', title: 'Utilisé', color: '#3b82f6' },
      ],
    );
    const result = await service.getBySetup(userId);
    const active0 = result.find((r) => r.setupId === sid('setup-active'));
    expect(active0?.count).toBe(0);
    expect(active0?.winRate).toBeNull();
    const archived = result.find((r) => r.setupId === sid('setup-arch'));
    expect(archived?.title).toBe('Archivé');
    expect(archived?.count).toBe(1);
  });

  it('R:R moyen null (et non 0) quand aucun trade du setup n’a de R:R ; P&L en net', async () => {
    await seed(
      [
        { ...makeTrade(10), riskReward: null, commission: 4, setupId: 'setup-sync' },
        { ...makeTrade(-10), riskReward: null, commission: 4, setupId: 'setup-sync' },
      ],
      [{ id: 'setup-sync', title: 'Sans setup', color: '#6b7280' }],
    );
    const s = (await service.getBySetup(userId)).find((r) => r.setupId === sid('setup-sync'));
    expect(s?.avgRR).toBeNull();
    expect(s?.pnl).toBe(-8);
  });
});

describe('getEquityCurve', () => {
  it("retourne des points cumulatifs dans l'ordre chronologique", async () => {
    await seed([makeTrade(100), makeTrade(-50), makeTrade(200)]);
    const result = await service.getEquityCurve(userId);
    expect(result.points.map((p) => p.cumulativePnl)).toEqual([100, 50, 250]);
    expect(result.startingCapital).toBeNull();
  });
});

describe('getEquityCurveDaily', () => {
  it('agrège correctement 3 trades le même jour en 1 point', async () => {
    const day = new Date('2026-05-04T10:00:00Z');
    await seed([{ pnl: 100, tradedAt: day }, { pnl: 200, tradedAt: day }, { pnl: -50, tradedAt: day }]);
    const result = await service.getEquityCurveDaily(userId);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].cumulativePnl).toBe(250);
  });

  it('cumule le P&L NET (frais déduits), comme les KPIs', async () => {
    await seed([{ pnl: 23.5, commission: 64.6, tradedAt: new Date('2026-09-14T15:00:00Z') }]);
    const result = await service.getEquityCurveDaily(userId);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].cumulativePnl).toBeCloseTo(-41.1);
  });

  it("retourne un point par jour actif dans l'ordre chronologique", async () => {
    await seed([{ pnl: -30, tradedAt: new Date('2026-05-11T10:00:00Z') }, { pnl: 100, tradedAt: new Date('2026-05-04T10:00:00Z') }]);
    const result = await service.getEquityCurveDaily(userId);
    expect(result.points).toHaveLength(2);
    expect(new Date(result.points[0].date) < new Date(result.points[1].date)).toBe(true);
  });

  it('le P&L est cumulé correctement sur plusieurs jours', async () => {
    await seed([{ pnl: 100, tradedAt: new Date('2026-05-04T10:00:00Z') }, { pnl: -50, tradedAt: new Date('2026-05-05T10:00:00Z') }]);
    const result = await service.getEquityCurveDaily(userId);
    expect(result.points.map((p) => p.cumulativePnl)).toEqual([100, 50]);
  });

  it('filtre correctement par from/to (les trades hors période sont exclus)', async () => {
    await seed([
      { pnl: 7, tradedAt: new Date('2026-04-30T10:00:00Z') },
      { pnl: 100, tradedAt: new Date('2026-05-04T10:00:00Z') },
      { pnl: 9, tradedAt: new Date('2026-06-02T10:00:00Z') },
    ]);
    const result = await service.getEquityCurveDaily(userId, new Date('2026-05-01'), new Date('2026-05-31'));
    expect(result.points).toHaveLength(1);
    expect(result.points[0].cumulativePnl).toBe(100);
  });

  it('jour du fuseau de Paris : 23 h 30 UTC un 4 mai = le 5 mai à Paris', async () => {
    await seed([{ pnl: 10, tradedAt: new Date('2026-05-04T23:30:00Z') }]);
    const result = await service.getEquityCurveDaily(userId);
    expect(new Date(result.points[0].date).toISOString().slice(0, 10)).toBe('2026-05-05');
  });

  it('retourne tableau vide si aucun trade', async () => {
    await seed([]);
    expect((await service.getEquityCurveDaily(userId)).points).toHaveLength(0);
  });

  it('getEquityCurveCurrentMonth ne garde que le mois courant', async () => {
    const now = new Date();
    await seed([
      { pnl: 5, tradedAt: new Date(now.getFullYear(), now.getMonth() - 1, 15, 12) },
      { pnl: 42, tradedAt: new Date(now.getFullYear(), now.getMonth(), 1, 12) },
    ]);
    const result = await service.getEquityCurveCurrentMonth(userId);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].cumulativePnl).toBe(42);
  });
});
