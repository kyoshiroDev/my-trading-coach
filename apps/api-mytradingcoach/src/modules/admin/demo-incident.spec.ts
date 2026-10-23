import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedTradingData } from './demo-seed';
import { buildDemoDataset } from './demo-data/generate';
import { DEMO_INCIDENT_ANALYSIS, buildLostDemoIncident, buildLostDemoTrades } from './demo-data/lost-accounts';
import { tradingDay } from '../accounts/account-rules';
import { buildIncidentReport } from '../accounts/incidents/incident-report';
import { formatMoney } from '@mtc/shared';

/**
 * Autopsie d'exemple du compte démo (#669) : une autopsie complète sur le compte échoué, avec un
 * texte d'analyse PRÉENREGISTRÉ (aucun appel IA), réservé à la vitrine démo.
 */
const NOW = new Date('2026-10-23T12:00:00.000Z');

/** Prisma minimal : enregistre les écritures, renvoie les setups par défaut et les plans du catalogue. */
function fakePrisma() {
  const writes: { model: string; op: string; data: unknown }[] = [];
  const model = (name: string) => ({
    upsert: vi.fn(async () => ({ id: 'demo-user-id' })),
    create: vi.fn(async ({ data }: { data: unknown }) => {
      writes.push({ model: name, op: 'create', data });
      return { id: `${name}-${writes.filter((w) => w.model === name).length}` };
    }),
    createMany: vi.fn(async ({ data }: { data: unknown }) => {
      writes.push({ model: name, op: 'createMany', data });
      return { count: 0 };
    }),
    count: vi.fn(async () => 0),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    update: vi.fn(async () => ({})),
    findMany: vi.fn(async () =>
      name === 'setup'
        ? ['Breakout', 'Pullback', 'Range', 'Reversal', 'Scalping', 'News'].map((title) => ({ id: `setup-${title}`, title }))
        : []),
  });
  const names = [
    'user', 'trade', 'tradeSession', 'weeklyDebrief', 'dailyRecap', 'setup', 'ecoEvent', 'tradingAccount',
    'brokerConnection', 'brokerDailyClose', 'accountRiskDay', 'propRiskEvent', 'behaviorAlert', 'accountIncident',
  ];
  const prisma = Object.fromEntries(names.map((n) => [n, model(n)])) as Record<string, unknown>;
  prisma['propFirmPlan'] = { findMany: vi.fn(async () => [{ id: 'apex-eod-50k' }, { id: 'tradeify-select-flex-50k' }]) };
  return { prisma: prisma as unknown as PrismaClient, writes };
}

const user = { id: 'demo-user-id', email: 'demo@mytradingcoach.app' } as Parameters<typeof seedTradingData>[1];

describe("Autopsie d'exemple du compte démo", () => {
  /**
   * Le jeu de données démo (tirage seedé jusqu'aux cibles de crédibilité) est la partie lourde du
   * seed : construit UNE fois pour tout le fichier, puis passé à `seedTradingData` (`dataset`).
   * Les tests ne recalculent plus que ce qu'ils vérifient. Délai explicite sur ce seul calcul : il
   * reste borné sous charge CI sans relever le délai des tests eux-mêmes.
   */
  let dataset: ReturnType<typeof buildDemoDataset>;
  beforeAll(() => {
    dataset = buildDemoDataset(NOW);
  }, 60_000);

  it('séance de casse : marge estimée positive jusqu’au dernier trade, franchie sur lui', () => {
    const trades = buildLostDemoTrades(NOW);
    const inc = buildLostDemoIncident(trades, tradingDay)!;
    const session = trades.filter((t) => t.account === 'apexFailed' && tradingDay(t.tradedAt) === inc.day);
    expect(session.map((t) => t.quantity)).toEqual([2, 2, 2, 4, 4]);
    const report = buildIncidentReport({
      kind: 'drawdown', currency: 'USD', snapshot: inc.snapshot,
      trades: session.map((t, i) => ({ id: `t${i}`, tradedAt: t.tradedAt, asset: t.asset, side: t.side, quantity: t.quantity, pnl: t.pnl, commission: t.commission })),
      alerts: [
        { at: inc.alert.at, source: 'behavior', type: inc.alert.type },
        ...inc.propEvents.map((e) => ({ at: e.at, source: 'prop' as const, type: 'drawdown', level: e.level })),
      ],
      previous: [],
    });
    const distances = report.series.map((p) => p.distance);
    expect(distances.slice(0, -1).every((d) => d > 0)).toBe(true);
    expect(distances.at(-1)).toBeLessThanOrEqual(0);
    expect(inc.snapshot.remaining).toBeLessThanOrEqual(0);
    expect(report.findings).toHaveLength(3);
    expect(report.timeline.filter((e) => e.type === 'trade' && e.afterAlert)).toHaveLength(2);
    expect(inc.propEvents.map((e) => e.level)).toEqual(['warning', 'critical', 'breached']);
  });

  it('seed démo : un incident sur le compte échoué, échec confirmé, analyse préenregistrée', async () => {
    const { prisma, writes } = fakePrisma();
    await seedTradingData(prisma, user, NOW, { brokerShowcase: true, dataset });
    const incidents = writes.filter((w) => w.model === 'accountIncident');
    expect(incidents).toHaveLength(1);
    const data = incidents[0].data as Record<string, unknown>;
    expect(data).toMatchObject({ kind: 'drawdown', period: 'account', aiAnalysis: DEMO_INCIDENT_ANALYSIS });
    expect(data['failedByIncidentAt']).toBeInstanceOf(Date);
    const accounts = writes.filter((w) => w.model === 'tradingAccount').map((w) => w.data as Record<string, unknown>);
    const failedIdx = accounts.findIndex((a) => a['status'] === 'FAILED');
    expect(data['accountId']).toBe(`tradingAccount-${failedIdx + 1}`);
    expect(writes.some((w) => w.model === 'behaviorAlert')).toBe(true);
  });

  it('compte de test rempli par seed:user : pas de texte préenregistré (le vrai parcours décide)', async () => {
    const { prisma, writes } = fakePrisma();
    await seedTradingData(prisma, user, NOW, { brokerShowcase: false, dataset });
    const data = writes.find((w) => w.model === 'accountIncident')!.data as Record<string, unknown>;
    expect(data['aiAnalysis']).toBeUndefined();
  });

  it("le texte d'exemple cite les montants nets affichés dans la chronologie (revue #712)", () => {
    const trades = buildLostDemoTrades(NOW);
    const inc = buildLostDemoIncident(trades, tradingDay)!;
    const session = trades.filter((t) => t.account === 'apexFailed' && tradingDay(t.tradedAt) === inc.day);
    const shown = session.slice(0, 3).map((t) => formatMoney(t.pnl - t.commission, 'USD', { decimals: 0 }));
    expect(DEMO_INCIDENT_ANALYSIS).toContain(`(${shown.join(', ')})`);
  });

  it("le texte d'exemple reste factuel : formule imposée, ni conseil ni promesse", () => {
    expect(DEMO_INCIDENT_ANALYSIS.startsWith("D'après tes trades enregistrés")).toBe(true);
    expect(DEMO_INCIDENT_ANALYSIS).not.toMatch(/devrais|conseil|achète|vends|garanti|promet|prévoi|il faut/i);
  });
});
