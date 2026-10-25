import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AccountStatus, Plan, Role } from '@prisma/client';
import { AI_MAX_TRIES_PER_DAY, AI_RETRY_DELAY_S, AccountIncidentsService, type IncidentUser } from './account-incidents.service';
import { INCIDENT_AI_MAX_TOKENS } from './incident-ai.prompt';

/**
 * Autopsie d'un compte grillé (#669) côté service : détection (un seul incident, jamais en démo),
 * échec confirmé depuis l'incident, « Ce n'est pas un échec », analyse IA unique et plafonnée.
 */
const FREE = { plan: Plan.FREE, role: Role.USER, trialEndsAt: null };
const PREMIUM = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };
const NOW = new Date('2026-10-14T09:13:00.000Z');

type Metrics = { drawdown?: object | null; dailyLoss?: object | null };

/**
 * Redis en mémoire, avec la sémantique utile au verrou d'analyse : `SET … EX … NX`, `EXPIRE`,
 * `INCR`, et une horloge qu'on avance à la main (`advance`, en secondes).
 */
function fakeRedis() {
  let now = 0;
  const store = new Map<string, { v: string; exp: number | null }>();
  const live = (k: string) => {
    const e = store.get(k);
    if (e && e.exp !== null && e.exp <= now) store.delete(k);
    return store.get(k);
  };
  const client = {
    set: vi.fn(async (k: string, v: string, _ex: 'EX', ttl: number, nx?: 'NX'): Promise<string | null> => {
      if (nx === 'NX' && live(k)) return null;
      store.set(k, { v, exp: now + ttl * 1000 });
      return 'OK';
    }),
    expire: vi.fn(async (k: string, ttl: number) => {
      const e = live(k);
      if (!e) return 0;
      e.exp = now + ttl * 1000;
      return 1;
    }),
    incr: vi.fn(async (k: string) => {
      const e = live(k);
      const n = (e ? Number(e.v) : 0) + 1;
      store.set(k, { v: String(n), exp: e?.exp ?? null });
      return n;
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
  return { client, advance: (s: number) => { now += s * 1000; }, ttl: (k: string) => live(k)?.exp ?? null, now: () => now };
}

function makeDeps() {
  const prisma = {
    user: {
      findUnique: vi.fn(async (): Promise<{ plan: Plan; role: Role; trialEndsAt: Date | null; isDemo: boolean }> => ({ ...PREMIUM, isDemo: false })),
    },
    tradingAccount: {
      findFirst: vi.fn(async (): Promise<{ status: AccountStatus }> => ({ status: AccountStatus.ACTIVE })),
      findUniqueOrThrow: vi.fn(
        async (): Promise<{ id: string; label: string; currency: string; status: AccountStatus }> =>
          ({ id: 'acc', label: 'Apex 50K #1', currency: 'USD', status: AccountStatus.FAILED }),
      ),
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
    list: vi.fn(async (): Promise<{ id: string; status: AccountStatus; metrics: Metrics }[]> => [{ id: 'acc', status: AccountStatus.ACTIVE, metrics }]),
    update: vi.fn(async (_u: string, id: string, dto: { status?: AccountStatus }) => ({ id, status: dto.status })),
  };
  const anthropic = {
    enabled: true,
    create: vi.fn(async () => ({ content: [{ type: 'text', text: "D'après tes trades enregistrés, la séance…" }] })),
  };
  const redis = fakeRedis();
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
  const confirmed = (status: AccountStatus) => ({ status, confirmIncident: true });

  it("feuille de choix, limite détectée : l'échec confirme l'incident (réactivation possible ensuite)", async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue({ id: 'inc' });
    await d.svc.updateAccount(user(), 'acc', confirmed(AccountStatus.FAILED), PREMIUM);
    // `confirmIncident` ne part jamais dans la mise à jour du compte (Prisma le refuserait).
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

  it("« Archiver » depuis la feuille de choix, limite détectée : confirme l'incident", async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue({ id: 'inc' });
    await d.svc.updateAccount(user(), 'acc', confirmed(AccountStatus.ARCHIVED), PREMIUM);
    expect(d.prisma.accountIncident.updateMany).toHaveBeenCalledWith({
      where: { id: 'inc', failedByIncidentAt: null },
      data: { failedByIncidentAt: expect.any(Date) },
    });
  });

  it("formulaire d'édition (sans confirmIncident) : archiver ou échouer ne confirme JAMAIS l'incident ouvert", async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue({ id: 'old-daily-loss' });
    await d.svc.updateAccount(user(), 'acc', { status: AccountStatus.ARCHIVED }, PREMIUM);
    await d.svc.updateAccount(user(), 'acc', { status: AccountStatus.FAILED }, PREMIUM);
    await d.svc.updateAccount(user(), 'acc', { status: AccountStatus.ARCHIVED, confirmIncident: false }, PREMIUM);
    expect(d.accounts.update).toHaveBeenCalledWith('u1', 'acc', { status: AccountStatus.ARCHIVED }, PREMIUM);
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
    // Une limite ouverte existe : pas d'incident « manual » en plus.
    expect(d.prisma.accountIncident.createMany).not.toHaveBeenCalled();
  });

  it("archivage répété : seul le premier (compte encore ACTIF) confirme l'incident", async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue({ id: 'inc' });
    await d.svc.updateAccount(user(), 'acc', confirmed(AccountStatus.ARCHIVED), PREMIUM);
    d.prisma.tradingAccount.findFirst.mockResolvedValue({ status: AccountStatus.ARCHIVED });
    await d.svc.updateAccount(user(), 'acc', confirmed(AccountStatus.ARCHIVED), PREMIUM);
    expect(d.prisma.accountIncident.updateMany).toHaveBeenCalledTimes(1);
    expect(d.prisma.accountIncident.createMany).not.toHaveBeenCalled();
  });

  it('simple archivage sans limite franchie : aucun incident créé', async () => {
    await d.svc.updateAccount(user(), 'acc', confirmed(AccountStatus.ARCHIVED), PREMIUM);
    expect(d.prisma.accountIncident.createMany).not.toHaveBeenCalled();
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
  });

  it('compte déjà échoué, ou autre changement : aucun incident touché', async () => {
    d.prisma.tradingAccount.findFirst.mockResolvedValue({ status: AccountStatus.FAILED });
    await d.svc.updateAccount(user(), 'acc', confirmed(AccountStatus.FAILED), PREMIUM);
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

  it('plancher atteint (B1) : marge et séance du retrait gardées dans le relevé de l’incident', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ failedByIncidentAt: NOW }));
    d.metrics.drawdown = { breached: true, maxDrawdown: 2000, margin: -60, floor: 48_000 };
    await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM, NOW);
    expect(d.prisma.accountIncident.update).toHaveBeenCalledWith({
      where: { id: 'inc' },
      data: {
        dismissedAt: NOW,
        data: { limit: 2000, remaining: -50, detectedAt: NOW.toISOString(), dismissedMargin: -60, dismissedDay: '2026-10-14' },
      },
    });
  });

  it('plancher plus atteint au moment du retrait : rien de mémorisé', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.metrics.drawdown = { breached: false, maxDrawdown: 2000, margin: 300, floor: 48_000 };
    await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM, NOW);
    expect(d.prisma.accountIncident.update).toHaveBeenCalledWith({ where: { id: 'inc' }, data: { dismissedAt: NOW } });
  });

  it('échec marqué à la main AVANT (incident non confirmé) : incident retiré, compte laissé échoué', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ kind: 'manual', data: null }));
    const res = await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM);
    expect(res).toEqual({ dismissed: true, reactivated: false });
    expect(d.accounts.update).not.toHaveBeenCalled();
  });

  it('compte déjà repassé en actif entre-temps : pas de changement de statut', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ failedByIncidentAt: NOW }));
    d.prisma.tradingAccount.findUniqueOrThrow.mockResolvedValue({ id: 'acc', label: 'x', currency: 'USD', status: AccountStatus.ACTIVE });
    expect(await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM)).toEqual({ dismissed: true, reactivated: false });
    expect(d.accounts.update).not.toHaveBeenCalled();
  });

  it('archivé depuis la feuille de choix en confirmant l’incident : remis en actif aussi', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident({ failedByIncidentAt: NOW }));
    d.prisma.tradingAccount.findUniqueOrThrow.mockResolvedValue({ id: 'acc', label: 'x', currency: 'USD', status: AccountStatus.ARCHIVED });
    expect(await d.svc.dismiss(user(), 'acc', 'inc', PREMIUM)).toEqual({ dismissed: true, reactivated: true });
    expect(d.accounts.update).toHaveBeenCalledWith('u1', 'acc', { status: AccountStatus.ACTIVE }, PREMIUM);
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

  it('verrou déjà pris : aucun second appel', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.redis.client.set.mockResolvedValue(null);
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });

  it('deux ouvertures simultanées : un seul appel IA, une seule écriture', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    let answer!: (v: { content: { type: 'text'; text: string }[] }) => void;
    d.anthropic.create.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const both = Promise.all([d.svc.analysis(user(), 'acc', 'inc'), d.svc.analysis(user(), 'acc', 'inc')]);
    await vi.waitFor(() => expect(d.anthropic.create).toHaveBeenCalledTimes(1));
    answer({ content: [{ type: 'text', text: "D'après tes trades enregistrés, une seule fois." }] });
    const results = await both;
    expect(d.anthropic.create).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status).sort()).toEqual(['ready', 'unavailable']);
    expect(d.prisma.accountIncident.updateMany).toHaveBeenCalledTimes(1);
  });

  it('appel en échec : rien d’inventé, rien d’écrit, nouvel essai seulement après le délai', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.anthropic.create.mockRejectedValueOnce(new Error('529'));
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
    // Rechargement immédiat : pas de nouvel appel pendant le délai.
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.anthropic.create).toHaveBeenCalledTimes(1);
    // Délai écoulé : nouvel essai, qui aboutit et s'enregistre.
    d.redis.advance(AI_RETRY_DELAY_S);
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toMatchObject({ status: 'ready' });
    expect(d.anthropic.create).toHaveBeenCalledTimes(2);
    expect(d.prisma.accountIncident.updateMany).toHaveBeenCalledTimes(1);
  });

  it('réponse vide (facturée) : même délai avant un nouvel essai, rien d’écrit', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.anthropic.create.mockResolvedValueOnce({ content: [] });
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.redis.ttl('incident-ai:inc')).toBe(d.redis.now() + AI_RETRY_DELAY_S * 1000);
    expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
    expect(d.anthropic.create).toHaveBeenCalledTimes(1);
    expect(d.prisma.accountIncident.updateMany).not.toHaveBeenCalled();
  });

  it(`plafond : ${AI_MAX_TRIES_PER_DAY} essais au plus par incident et par jour, même espacés`, async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    d.anthropic.create.mockRejectedValue(new Error('529'));
    for (let i = 0; i < AI_MAX_TRIES_PER_DAY + 2; i++) {
      expect(await d.svc.analysis(user(), 'acc', 'inc')).toEqual({ status: 'unavailable' });
      d.redis.advance(AI_RETRY_DELAY_S);
    }
    expect(d.anthropic.create).toHaveBeenCalledTimes(AI_MAX_TRIES_PER_DAY);
  });

  it('succès : le verrou garde sa durée longue (l’analyse enregistrée bloque tout second appel)', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    await d.svc.analysis(user(), 'acc', 'inc');
    expect(d.redis.client.expire).not.toHaveBeenCalledWith('incident-ai:inc', AI_RETRY_DELAY_S);
    expect(d.redis.client.del).not.toHaveBeenCalled();
  });

  it('la page (GET) ne déclenche jamais d’appel', async () => {
    d.prisma.accountIncident.findFirst.mockResolvedValue(incident());
    const page = await d.svc.get(user(), 'acc', 'inc');
    expect(page.ai).toEqual({ status: 'pending' });
    expect(page.disclaimer).toMatch(/Estimation MyTradingCoach/);
    expect(d.anthropic.create).not.toHaveBeenCalled();
  });
});
