import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiveawayActivation, GiveawayPool, Prisma } from '@prisma/client';
import { GiveawayDrawService, eligibleHash } from './giveaway-draw.service';
import { GiveawayCron, GIVEAWAY_CRON } from './giveaway.cron';

const NOW = new Date('2027-02-01T08:00:00Z');

type Draw = { id: string; period: string; pool: GiveawayPool };
let draws: Draw[] = [];
let wins: { id: string; drawId: string; userId: string }[] = [];

const tx = {
  giveawayDraw: {
    create: vi.fn(async ({ data }: { data: Draw & Record<string, unknown> }) => {
      if (draws.some((d) => d.period === data.period && d.pool === data.pool)) {
        throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
      }
      const d = { ...data, id: `draw-${draws.length + 1}` };
      draws.push(d);
      return d;
    }),
  },
  giveawayWin: {
    create: vi.fn(async ({ data }: { data: { drawId: string; userId: string } }) => {
      const w = { ...data, id: `win-${wins.length + 1}` };
      wins.push(w);
      return w;
    }),
  },
};
const prisma = {
  ...tx,
  giveawayDraw: {
    ...tx.giveawayDraw,
    findUnique: vi.fn(async ({ where }: { where: { period_pool: { period: string; pool: GiveawayPool } } }) =>
      draws.find((d) => d.period === where.period_pool.period && d.pool === where.period_pool.pool) ?? null,
    ),
  },
  giveawayWin: {
    ...tx.giveawayWin,
    findUnique: vi.fn(async () => ({ prizeMonths: 1, endsAt: new Date('2027-03-01T08:00:00Z'), user: { email: 'g@test.local', name: 'Gagnant' } })),
  },
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};
const settings = { isEnabled: vi.fn(async () => true) };
const eligibility = { eligibleIds: vi.fn(async () => ['a', 'b', 'c']) };
const prizes = { apply: vi.fn(async () => ({ status: GiveawayActivation.APPLIED, error: null })) };
const resend = { sendAdminAlert: vi.fn(async () => undefined) };
const service = new GiveawayDrawService(prisma as never, settings as never, eligibility as never, prizes as never, resend as never);

beforeEach(() => {
  draws = [];
  wins = [];
  vi.clearAllMocks();
  vi.spyOn(service, 'pickIndex').mockReturnValue(1);
});

describe('GiveawayDrawService', () => {
  it('tirage : gagnant au rang tiré, trace d’audit, lot attribué, e-mail à l’admin', async () => {
    const out = await service.draw(GiveawayPool.FREE, NOW);
    expect(out).toEqual({ kind: 'drawn', drawId: 'draw-1', winId: 'win-1', activation: GiveawayActivation.APPLIED });
    expect(tx.giveawayDraw.create.mock.calls[0][0].data).toMatchObject({
      period: '2027-02', pool: 'FREE', eligibleCount: 3, winnerId: 'b', drawnIndex: 1, eligibleHash: eligibleHash(['a', 'b', 'c']),
    });
    expect(wins[0]).toMatchObject({ userId: 'b', prizeMonths: 1 });
    expect(prizes.apply).toHaveBeenCalledWith('win-1', NOW);
    expect(resend.sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(resend.sendAdminAlert.mock.calls[0][1]).toContain('Éligibles : 3');
  });

  it('idempotence : deux lancements du cron → un seul tirage', async () => {
    const cron = new GiveawayCron(service);
    await cron.run(NOW);
    await cron.run(NOW);
    expect(draws.filter((d) => d.pool === GiveawayPool.FREE)).toHaveLength(1);
    expect(draws.filter((d) => d.pool === GiveawayPool.PREMIUM)).toHaveLength(1);
    expect(prizes.apply).toHaveBeenCalledTimes(2); // un lot par tirage, pas un de plus
  });

  it('course : la contrainte unique tranche (P2002 → déjà tiré, aucun lot)', async () => {
    prisma.giveawayDraw.findUnique.mockResolvedValueOnce(null); // lecture avant que l'autre écrive
    draws.push({ id: 'draw-x', period: '2027-02', pool: GiveawayPool.FREE });
    const out = await service.draw(GiveawayPool.FREE, NOW);
    expect(out).toEqual({ kind: 'already-drawn', drawId: 'draw-x' });
    expect(prizes.apply).not.toHaveBeenCalled();
  });

  it('aucun éligible : tirage enregistré avec 0, pas de gagnant, e-mail à l’admin', async () => {
    eligibility.eligibleIds.mockResolvedValueOnce([]);
    const out = await service.draw(GiveawayPool.PREMIUM, NOW);
    expect(out).toEqual({ kind: 'no-eligible', drawId: 'draw-1' });
    expect(tx.giveawayDraw.create.mock.calls[0][0].data).toMatchObject({ eligibleCount: 0, winnerId: null, drawnIndex: null });
    expect(wins).toHaveLength(0);
    expect(resend.sendAdminAlert.mock.calls[0][0]).toContain('aucun éligible');
  });

  it('interrupteur éteint : rien ne se passe', async () => {
    settings.isEnabled.mockResolvedValue(false);
    expect(await service.draw(GiveawayPool.FREE, NOW)).toEqual({ kind: 'disabled' });
    expect(eligibility.eligibleIds).not.toHaveBeenCalled();
    expect(tx.giveawayDraw.create).not.toHaveBeenCalled();
    expect(resend.sendAdminAlert).not.toHaveBeenCalled();
    settings.isEnabled.mockResolvedValue(true);
  });

  it('lot non attribué : l’e-mail à l’admin le dit et renvoie vers « Relancer l’attribution »', async () => {
    prizes.apply.mockResolvedValueOnce({ status: GiveawayActivation.FAILED, error: 'Compte plus éligible' });
    const out = await service.draw(GiveawayPool.FREE, NOW);
    expect(out).toMatchObject({ kind: 'drawn', activation: GiveawayActivation.FAILED });
    expect(resend.sendAdminAlert.mock.calls[0][1]).toContain('NON attribué');
  });

  it('cron le 1er à 9 h, tiré des constantes partagées', () => {
    expect(GIVEAWAY_CRON).toBe('0 9 1 * *');
  });
});
