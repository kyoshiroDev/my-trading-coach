/**
 * Autopsie d'un compte grillé (#669), sur la vraie base.
 *
 * Ce que les specs unitaires ne prouvent pas : que l'import déclenche bien la détection, que
 * l'unicité `accountId + kind + period` tient quand plusieurs déclencheurs tirent en même temps,
 * et que « Ce n'est pas un échec » remet le compte en actif seulement après un échec confirmé
 * depuis l'incident (jamais après un échec marqué à la main), sans que l'incident revienne.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { AccountStatus, DrawdownType, Plan, Role, TradeSource } from '@prisma/client';
import { createIntegrationApp } from '../../../test/integration-app.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { TradesService } from '../../trades/trades.service';
import { AccountsService } from '../accounts.service';
import { AccountIncidentsService, type IncidentUser } from './account-incidents.service';

const PREFIX = 'int-autopsie-';
const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const FREE = { plan: Plan.FREE, role: Role.USER, trialEndsAt: null };

let app: INestApplication;
let prisma: PrismaService;
let trades: TradesService;
let incidents: AccountIncidentsService;
let accounts: AccountsService;

/** Compte ACTIF à drawdown statique saisi à la main (2 000 $ sous 50 000 $), avec un setup. */
async function seed(isDemo = false) {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}${uid()}@test.local`, password: 'x', name: 'Autopsie', isDemo },
  });
  const setup = await prisma.setup.create({ data: { userId: user.id, title: 'S', color: '#10b981', sortOrder: 0 } });
  const account = await prisma.tradingAccount.create({
    data: {
      userId: user.id, label: 'Apex 50K #1', accountSize: 50_000, startingBalance: 50_000,
      maxDrawdown: 2_000, drawdownType: DrawdownType.STATIC,
    },
  });
  const asUser: IncidentUser = { id: user.id, ...FREE, isDemo };
  return { user: asUser, setupId: setup.id, accountId: account.id };
}

/**
 * Séance passée à date FIXE (mercredi 14/10/2026, 9 h à Chicago) : trois trades, quantité qui
 * double sur le dernier. Avec « maintenant − 24 h », la séance se coupait en deux journées CME
 * (bascule à 17 h Chicago) quand le test tournait dans les 40 min avant, et les KPI changeaient.
 */
const SESSION_START = Date.UTC(2026, 9, 14, 14, 0);

function session(setupId: string, accountId: string, pnls: number[]) {
  const base = SESSION_START;
  return pnls.map((pnl, i) => ({
    asset: 'MNQ', side: 'LONG' as const, entry: 100, exit: 101, pnl, commission: 0,
    quantity: i === pnls.length - 1 ? 4 : 2, setupId, accountId,
    session: 'NEW_YORK' as const, timeframe: 'M5', tradedAt: new Date(base + i * 20 * 60_000).toISOString(),
  }));
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  trades = app.get(TradesService);
  incidents = app.get(AccountIncidentsService);
  accounts = app.get(AccountsService);
});

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await app?.close().catch(() => undefined);
});

describe('Autopsie — détection', () => {
  it("l'import qui fait franchir le plancher crée l'incident ; les déclencheurs simultanés n'en créent qu'un", async () => {
    const { setupId, accountId } = await seed();
    const userId = (await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).userId;
    await trades.importTrades(userId, session(setupId, accountId, [-700, -600, -900]), TradeSource.BROKER_SYNC);

    await Promise.all([1, 2, 3].map(() => incidents.detect(userId, accountId, 'sync')));
    const rows = await prisma.accountIncident.findMany({ where: { accountId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'drawdown', period: 'account', source: 'sync' });
    expect(rows[0].data).toMatchObject({ limit: 2_000, remaining: -200 });
  });

  it('limite non franchie : aucun incident', async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-300, 200]), TradeSource.BROKER_SYNC);
    expect(await prisma.accountIncident.count({ where: { accountId } })).toBe(0);
  });

  it('compte démo : aucun incident hors du seed', async () => {
    const { user, setupId, accountId } = await seed(true);
    await prisma.trade.createMany({
      data: session(setupId, accountId, [-1_500, -900]).map((t) => ({ ...t, userId: user.id, tags: [], tradedAt: new Date(t.tradedAt) })),
    });
    expect(await incidents.detect(user.id, accountId, 'sync')).toBe(0);
    expect(await prisma.accountIncident.count({ where: { accountId } })).toBe(0);
  });
});

describe("Autopsie — « Ce n'est pas un échec »", () => {
  it("échec confirmé depuis l'incident : compte remis en actif, autopsie retirée et jamais recréée", async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-700, -600, -900]), TradeSource.BROKER_SYNC);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.FAILED, confirmIncident: true }, FREE);

    const [listed] = await incidents.list(user.id, accountId);
    const page = await incidents.get(user, accountId, listed.id);
    expect(page.canReactivate).toBe(true);
    expect(page.kpis).toMatchObject({ trades: 3, net: -2_200, maxQuantity: 4, firstQuantity: 2, startDistance: 2_000 });
    expect(page.ai).toEqual({ status: 'locked' });

    expect(await incidents.dismiss(user, accountId, listed.id, FREE)).toEqual({ dismissed: true, reactivated: true });
    expect((await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe(AccountStatus.ACTIVE);

    // Le plancher reste franchi : la détection suivante ne recrée pas l'autopsie retirée.
    await incidents.detect(user.id, accountId, 'sync');
    expect(await prisma.accountIncident.count({ where: { accountId } })).toBe(1);
    expect(await incidents.list(user.id, accountId)).toEqual([]);
  });

  it("« Archiver » depuis la feuille de choix : confirme l'incident, la liste des comptes porte le lien", async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-700, -600, -900]), TradeSource.BROKER_SYNC);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED, confirmIncident: true }, FREE);

    const [listed] = await incidents.list(user.id, accountId);
    const account = (await accounts.list(user.id)).find((a) => a.id === accountId);
    expect(account?.openIncidentId).toBe(listed.id);
    expect(await incidents.dismiss(user, accountId, listed.id, FREE)).toEqual({ dismissed: true, reactivated: true });
    expect((await accounts.list(user.id)).find((a) => a.id === accountId)).toMatchObject({
      status: AccountStatus.ACTIVE, openIncidentId: null,
    });
  });

  it("archivage répété : un seul incident, date de confirmation inchangée", async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-700, -600, -900]), TradeSource.BROKER_SYNC);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED, confirmIncident: true }, FREE);
    const first = await prisma.accountIncident.findMany({ where: { accountId } });
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED, confirmIncident: true }, FREE);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED, confirmIncident: true }, FREE);
    const after = await prisma.accountIncident.findMany({ where: { accountId } });
    expect(after).toHaveLength(1);
    expect(first[0].failedByIncidentAt).not.toBeNull();
    expect(after[0].failedByIncidentAt).toEqual(first[0].failedByIncidentAt);
  });

  it("archivage depuis le formulaire d'édition (sans confirmIncident) : l'autopsie ouverte n'est pas confirmée", async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-700, -600, -900]), TradeSource.BROKER_SYNC);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED }, FREE);

    const [row] = await prisma.accountIncident.findMany({ where: { accountId } });
    expect(row.failedByIncidentAt).toBeNull();
    expect((await incidents.get(user, accountId, row.id)).canReactivate).toBe(false);
    // « Ce n'est pas un échec » retire l'autopsie sans toucher au compte rangé volontairement.
    expect(await incidents.dismiss(user, accountId, row.id, FREE)).toEqual({ dismissed: true, reactivated: false });
    expect((await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe(AccountStatus.ARCHIVED);
  });

  it('archivage sans limite franchie, même répété : aucun incident, aucun lien', async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-300, 150]), TradeSource.BROKER_SYNC);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED }, FREE);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.ARCHIVED }, FREE);
    expect(await prisma.accountIncident.count({ where: { accountId } })).toBe(0);
    expect((await accounts.list(user.id)).find((a) => a.id === accountId)).toMatchObject({
      status: AccountStatus.ARCHIVED, openIncidentId: null,
    });
  });

  it('échec marqué à la main sans limite franchie : autopsie retirée, compte laissé échoué', async () => {
    const { user, setupId, accountId } = await seed();
    await trades.importTrades(user.id, session(setupId, accountId, [-300, 150]), TradeSource.BROKER_SYNC);
    await incidents.updateAccount(user, accountId, { status: AccountStatus.FAILED }, FREE);

    const [listed] = await incidents.list(user.id, accountId);
    expect(listed.kind).toBe('manual');
    expect((await incidents.get(user, accountId, listed.id)).canReactivate).toBe(false);
    expect(await incidents.dismiss(user, accountId, listed.id, FREE)).toEqual({ dismissed: true, reactivated: false });
    expect((await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe(AccountStatus.FAILED);
  });

  it("autopsie d'un autre utilisateur : 404", async () => {
    const a = await seed();
    const b = await seed();
    await trades.importTrades(a.user.id, session(a.setupId, a.accountId, [-2_500]), TradeSource.BROKER_SYNC);
    const [listed] = await incidents.list(a.user.id, a.accountId);
    await expect(incidents.get(b.user, a.accountId, listed.id)).rejects.toThrow('Autopsie introuvable.');
    await expect(incidents.dismiss(b.user, a.accountId, listed.id, FREE)).rejects.toThrow('Autopsie introuvable.');
  });

  describe('plancher écarté par « Ce n’est pas un échec » (B1)', () => {
    async function dismissedFloor() {
      const { user, setupId, accountId } = await seed();
      await trades.importTrades(user.id, session(setupId, accountId, [-2_500]), TradeSource.BROKER_SYNC);
      const [listed] = await incidents.list(user.id, accountId);
      const floor = async () => (await accounts.list(user.id)).find((a) => a.id === accountId)!.floorReached;
      expect(await floor()).toBe(true);
      await incidents.dismiss(user, accountId, listed.id, FREE);
      return { user, setupId, accountId, incidentId: listed.id, floor };
    }

    it('le bandeau ne revient que sur une perte plus profonde', async () => {
      const { user, setupId, accountId, incidentId, floor } = await dismissedFloor();
      const row = await prisma.accountIncident.findUniqueOrThrow({ where: { id: incidentId } });
      expect(row.data).toMatchObject({ limit: 2_000, dismissedMargin: -500 });
      expect(await floor()).toBe(false);
      await trades.importTrades(user.id, [{ ...session(setupId, accountId, [-100])[0], tradedAt: new Date(SESSION_START + 90 * 60_000).toISOString() }], TradeSource.BROKER_SYNC);
      expect(await floor()).toBe(true);
    });

    it('séance suivante, deux lectures simultanées : effacé une fois, aucune lecture en échec, relevé gardé', async () => {
      const { user, incidentId, floor } = await dismissedFloor();
      const row = await prisma.accountIncident.findUniqueOrThrow({ where: { id: incidentId } });
      await prisma.accountIncident.update({
        where: { id: incidentId },
        data: { data: { ...(row.data as object), dismissedDay: '2000-01-03' } },
      });
      const [a, b] = await Promise.all([accounts.list(user.id), accounts.list(user.id)]);
      expect(a.find((x) => x.floorReached)).toBeDefined();
      expect(b.find((x) => x.floorReached)).toBeDefined();
      const after = (await prisma.accountIncident.findUniqueOrThrow({ where: { id: incidentId } })).data as Record<string, unknown>;
      expect(after).not.toHaveProperty('dismissedMargin');
      expect(after).not.toHaveProperty('dismissedDay');
      expect(after).toMatchObject({ limit: 2_000, remaining: -500 });
      expect(await floor()).toBe(true);
    });

    it('retrait plus récent que la lecture : jamais effacé par elle (écriture conditionnelle)', async () => {
      const { incidentId } = await dismissedFloor();
      const row = await prisma.accountIncident.findUniqueOrThrow({ where: { id: incidentId } });
      // Ce qu'une lecture périmée tenterait (retrait du 03/01/2000), alors que la base porte celui du jour.
      const res = await prisma.accountIncident.updateMany({
        where: {
          id: incidentId,
          AND: [
            { data: { path: ['dismissedDay'], equals: '2000-01-03' } },
            { data: { path: ['dismissedMargin'], equals: -500 } },
          ],
        },
        data: { data: { limit: 2_000 } },
      });
      expect(res.count).toBe(0);
      expect((await prisma.accountIncident.findUniqueOrThrow({ where: { id: incidentId } })).data).toEqual(row.data);
    });
  });
});
