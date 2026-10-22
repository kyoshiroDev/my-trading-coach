import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AccountStatus, Plan, Role } from '@prisma/client';
import { AccountIncidentsService, type IncidentUser } from './account-incidents.service';
import { INCIDENT_AI_MAX_TOKENS } from './incident-ai.prompt';

/**
 * Autopsie d'un compte grillé (#669) côté service : détection (un seul incident, jamais en démo),
 * échec confirmé depuis l'incident, « Ce n'est pas un échec », analyse IA unique et plafonnée.
 */
const FREE = { plan: Plan.FREE, role: Role.USER, trialEndsAt: null };
const PREMIUM = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };
const NOW = new Date('2026-10-14T09:13:00.000Z');

type Metrics = { drawdown?: object | null; dailyLoss?: object | null };

function makeDeps() {
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ ...PREMIUM, isDemo: false })) },
    tradingAccount: {
      findFirst: vi.fn(async () => ({ status: AccountStatus.ACTIVE })),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'acc', label: 'Apex 50K #1', currency: 'USD', status: AccountStatus.FAILED })),
      count: vi.fn(async () => 1),
    },
    trade: {
      findFirst: vi.fn(async () => ({ tradedAt: new Date('2026-10-13T15:00:00.000Z') })),
      findMany: vi.fn(async () => []),
    },
    behaviorAlert: { findMany: vi.fn(async () => []) },
    propRiskEvent: { findMany: vi.fn(async () => []) },
    accountIncident: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      findFirst: vi.fn(async (): Promise<unknown> => null),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
  };
  const metrics: Metrics = {};
  const accounts = {
    list: vi.fn(async () => [{ id: 'acc', status: AccountStatus.ACTIVE, metrics }]),
    update: vi.fn(async (_u: string, id: string, dto: { status?: AccountStatus }) => ({ id, status: dto.status })),
  };
  const anthropic = {
    enabled: true,
    create: vi.fn(async () => ({ content: [{ type: 'text', text: "D'après tes trades enregistrés, la séance…" }] })),
  };
  const redis = { client: { set: vi.fn(async (): Promise<string | null> => 'OK') } };
  const svc = new AccountIncidentsService(prisma as never, accounts as never, anthropic as never, redis as never);
  return { prisma, accounts, anthropic, redis, metrics, svc };
}

const incident = (over: Record<string, unknown> = {}) => ({
  id: 'inc', userId: 'u1', accountId: 'acc', kind: 'drawdown', period: 'account',
  tradeDate: new Date('2026-10-14T00:00:00.000Z'), source: 'sync',
  data: { limit: 2000, remaining: -50, detectedAt: NOW.toISOString() },
  failedByIncidentAt: null, aiAnalysis: null, aiGeneratedAt: null, dismissedAt: null, createdAt: NOW,
  ...over,
});

const user = (over: Partial<IncidentUser> = {}): IncidentUser => ({ id: 'u1', ...PREMIUM, isDemo: false, ...over });

describe('AccountIncidentsService.detect', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => { d = makeDeps(); });

  it('plancher franchi : un incident par compte (period « account »), doublon écarté par la base', async () => {
    d.metrics.drawdown = { breached: true, maxDrawdown: 2000, margin: -50, floor: 48_000 };
    await d.svc.detect('u1', 'acc', 'sync', NOW);
    const arg = d.prisma.accountIncident.createMany.mock.calls[0][0] as unknown as { data: Record<string, unknown>[]; skipDuplicates: boolean };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([expect.objectContaining({
      kind: 'drawdown', period: 'account', source: 'sync',
      // Après une synchro : séance de la dernière sortie (13/10 10 h Chicago), pas celle du jour.
      tradeDate: new Date('2026-10-13T00:00:00.000Z'),
      data: expect.objectContaining({ limit: 2000, remaining: -50, floor: 48_000 }),
    })]);
  });

  it('perte du jour franchie : un incident par compte ET par séance', async () => {
    d.metrics.dailyLoss = { breached: true, limit: 1000, remaining: -20 };
    await d.svc.detect('u1', 'acc', 'live', NOW);
    const arg = d.prisma.accountIncident.createMany.mock.calls[0][0] as unknown as { data: Record<string, unknown>[] };
    expect(arg.data[0]).toMatchObject({ kind: 'daily_loss', period: '2026-10-14', source: 'live' });
  });

  it('compte démo : jamais d’incident hors du seed', async () => {
    d.prisma.user.findUnique.mockResolvedValue({ ...PREMIUM, isDemo: true });
    d.metrics.drawdown = { breached: true, maxDrawdown: 2000, margin: -50, floor: 0 };
    expect(await d.svc.detect('u1', 'acc', 'sync', NOW)).toBe(0);
    expect(d.accounts.list).not.toHaveBeenCalled();
    expect(d.prisma.accountIncident.createMany).not.toHaveBeenCalled();
  });

  it('compte déjà échoué / archivé, ou limite non franchie : rien', async () => {
    d.metrics.drawdown = { breached: false, maxDrawdown: 2000, margin: 300, floor: 0 };
    expect(await d.svc.detect('u1', 'acc', 'sync', NOW)).toBe(0);
    d.accounts.list.mockResolvedValue([{ id: 'acc', status: AccountStatus.FAILED, metrics: { drawdown: { breached: true } } }]);
    expect(await d.svc.detect('u1', 'acc', 'sync', NOW)).toBe(0);
    expect(d.prisma.accountIncident.createMany).not.toHaveBeenCalled();
  });

  it('perte du jour lue avec le plan réel (Premium) ; Gratuit : métrique non calculée', async () => {
    d.prisma.user.findUnique.mockResolvedValue({ ...FREE, isDemo: false });
    await d.svc.detect('u1', 'acc', 'sync', NOW);
    expect(d.accounts.list).toHaveBeenCalledWith('u1', { premium: false });
  });

  it('detectQuietly : une erreur ne remonte jamais à la synchro', async () => {
    d.accounts.list.mockRejectedValue(new Error('base indisponible'));
    await expect(d.svc.detectQuietly('u1', 'acc', 'sync')).resolves.toBeUndefined();
  });
});

describe('AccountIncidentsService.updateAccount — passage en échoué', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => { d = makeDeps(); });

  it("limite détectée : l'échec confirme l'incident (réactivation possible ensuite)", async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue({ id: 'inc' });
    await d.svc.updateAccount(user(), 'acc', { status: AccountStatus.FAILED }, PREMIUM);
    expect(d.accounts.update).toHaveBeenCalledWith('u1', 'acc', { status: AccountStatus.FAILED }, PREMIUM);
    expect(d.prisma.accountIncident.updateMany).toHaveBeenCalledWith({
      where: { id: 'inc', failedByIncidentAt: null },
      data: { failedByIncidentAt: expect.any(Date) },
    });
  });

  it('aucune limite détectée : échec marqué à la main → incident « manual », jamais réactivable', async () => {
    await d.svc.updateAccount(user(), 'acc', { status: AccountStatus.FAILED }, PREMIUM);
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
    const arg = d.prisma.accountIncident.createMany.mock.calls[0][0] as unknown as { data: Record<string, unknown>[] };
    expect(arg.data[0]).toMatchObject({ kind: 'manual', period: 'account', source: 'manual' });
    expect(arg.data[0]).not.toHaveProperty('failedByIncidentAt');
  });

  it('compte déjà échoué, ou autre changement : aucun incident touché', async () => {
    d.prisma.tradingAccount.findFirst.mockResolvedValue({ status: AccountStatus.FAILED });
    await d.svc.updateAccount(user(), 'acc', { status: AccountStatus.FAILED }, PREMIUM);
    d.prisma.tradingAccount.findFirst.mockResolvedValue({ status: AccountStatus.ACTIVE });
    await d.svc.updateAccount(user(), 'acc', { label: 'Apex' } as never, PREMIUM);
    expect(d.prisma.accountIncident.createMany).not.toHaveBeenCalled();
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
  });
});

describe("AccountIncidentsService.dismiss — « Ce n'est pas un échec »", () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => { d = makeDeps(); });

  it('échec confirmé depuis CET incident : compte remis en actif (quota vérifié), incident retiré', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ failedByIncidentAt: NOW }));
    const res = await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM);
    expect(res).toEqual({ dismissed: true, reactivated: true });
    expect(d.accounts.update).toHaveBeenCalledWith('u1', 'acc', { status: AccountStatus.ACTIVE }, PREMIUM);
    expect(d.prisma.accountIncident.update).toHaveBeenCalledWith({ where: { id: 'inc' }, data: { dismissedAt: expect.any(Date) } });
  });

  it('échec marqué à la main AVANT (incident non confirmé) : incident retiré, compte laissé échoué', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ kind: 'manual', data: null }));
    const res = await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM);
    expect(res).toEqual({ dismissed: true, reactivated: false });
    expect(d.accounts.update).not.toHaveBeenCalled();
  });

  it('compte déjà repassé en actif ou archivé entre-temps : pas de changement de statut', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ failedByIncidentAt: NOW }));
    d.prisma.tradingAccount.findUniqueOrThrow.mockResolvedValue({ id: 'acc', label: 'x', currency: 'USD', status: AccountStatus.ARCHIVED });
    expect(await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM)).toEqual({ dismissed: true, reactivated: false });
    expect(d.accounts.update).not.toHaveBeenCalled();
  });

  it('quota atteint : la réactivation échoue et l’incident reste en place', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ failedByIncidentAt: NOW }));
    d.accounts.update.mockRejectedValue(new Error('ACCOUNT_LIMIT_REACHED'));
    await expect(d.svc.dismiss(user(), 'acc', 'inc', FREE)).rejects.toThrow('ACCOUNT_LIMIT_REACHED');
    expect(d.prisma.accountIncident.update).not.toHaveBeenCalled();
  });

  it('incident déjà retiré ou d’un autre utilisateur : 404', async () => {
    await expect(d.svc.dismiss(user(), 'acc', 'inc', PREMIUM)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AccountIncidentsService.analysis — IA Premium, une seule fois', () => {
  let d: ReturnType<typeof makeDeps>;
  beforeEach(() => { d = makeDeps(); });

  it('Premium, pas encore générée : un appel plafonné à 400 tokens, conservé sans écraser', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    const res = await d.svc.analysis(user(), 'acc', 'inc');
    expect(res).toMatchObject({ status: 'ready', text: "D'après tes trades enregistrés, la séance…" });
    expect(d.anthropic.create).toHaveBeenCalledTimes(1);
    const calls = d.anthropic.create.mock.calls as unknown as [{ max_tokens: number }, { feature: string }][];
    expect(calls[0][0].max_tokens).toBe(INCIDENT_AI_MAX_TOKENS);
    expect(calls[0][1]).toEqual({ feature: 'incident', userId: 'u1' });
    expect(d.prisma.accountIncident.updateMany).toHaveBeenCalledWith({
      where: { id: 'inc', aiAnalysis: null },
      data: { aiAnalysis: expect.any(String), aiGeneratedAt: expect.any(Date) },
    });
  });

  it('déjà générée : rendue telle quelle, jamais régénérée', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ aiAnalysis: 'Texte conservé', aiGeneratedAt: NOW }));
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'ready', text: 'Texte conservé', generatedAt: NOW });
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });

  it('Gratuit : verrouillée, aucun appel', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    expect(await d.svc.analysis(user(FREE), 'acc', 'inc')).toEqual({ status: 'locked' });
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });

  it('compte démo ou IA coupée (hors prod) : aucun appel', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    expect(await d.svc.analysis(user({ isDemo: true }), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    d.anthropic.enabled = false;
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });

  it('verrou déjà pris (ouverture simultanée, ou échec il y a moins d’une heure) : aucun second appel', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.redis.client.set.mockResolvedValue(null);
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });

  it('appel en échec : rien d’inventé, rien d’écrit', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.anthropic.create.mockRejectedValue(new Error('529'));
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
  });

  it('la page (GET) ne déclenche jamais d’appel', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    const page = await d.svc.get(user(), 'acc', 'inc');
    expect(page.ai).toEqual({ status: 'pending' });
    expect(page.disclaimer).toMatch(/Estimation MyTradingCoach/);
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });
});
