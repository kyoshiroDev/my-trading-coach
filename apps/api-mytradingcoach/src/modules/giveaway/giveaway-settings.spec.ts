import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GiveawayPool, Role } from '@prisma/client';
import { matchWhere } from '../../test/prisma-where';
import { GiveawaySettingsService, announceAudienceWhere } from './giveaway-settings.service';

type Settings = Record<string, unknown>;
let row: Settings;

const prisma = {
  giveawaySettings: {
    upsert: vi.fn(async () => row),
    findUnique: vi.fn(async () => row),
    update: vi.fn(async ({ data }: { data: Settings }) => Object.assign(row, data)),
    updateMany: vi.fn(async ({ where, data }: { where: Settings; data: Settings }) => {
      const { id: _id, ...conds } = where;
      const ok = Object.entries(conds).every(([k, v]) => row[k] === v);
      if (ok) Object.assign(row, data);
      return { count: ok ? 1 : 0 };
    }),
  },
  user: { count: vi.fn(async () => 42), findMany: vi.fn(async () => []) },
};
const dispatch = { allowedUsers: vi.fn(async () => new Set()), dispatch: vi.fn() };
const redis = { set: vi.fn(async () => 'OK'), get: vi.fn(async () => null), del: vi.fn() };
const env: Record<string, string | undefined> = {};
const config = { get: vi.fn((k: string) => env[k]) };
const service = new GiveawaySettingsService(prisma as never, dispatch as never, { client: redis } as never, config as never);

beforeEach(() => {
  vi.clearAllMocks();
  row = { id: 1, freeEnabled: false, premiumEnabled: false, freeEnabledAt: null, premiumEnabledAt: null, freeAnnouncedAt: null, premiumAnnouncedAt: null };
  for (const k of Object.keys(env)) delete env[k];
});

describe('GiveawaySettingsService : interrupteurs et annonce', () => {
  it('éteint par défaut', async () => {
    expect(await service.isEnabled(GiveawayPool.FREE)).toBe(false);
    expect(await service.isEnabled(GiveawayPool.PREMIUM)).toBe(false);
  });

  it('allumer : date d’activation, annonce lancée une seule fois (double clic compris)', async () => {
    const announce = vi.spyOn(service, 'announce').mockResolvedValue({ sent: 0, skipped: 0, errors: 0 });
    expect(await service.setEnabled(GiveawayPool.FREE, true)).toBe(42);
    expect(row.freeEnabled).toBe(true);
    expect(row.freeEnabledAt).toBeInstanceOf(Date);
    expect(row.freeAnnouncedAt).toBeInstanceOf(Date);
    expect(await service.setEnabled(GiveawayPool.FREE, true)).toBe(0);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(row.premiumEnabled).toBe(false); // interrupteurs indépendants
  });

  it('éteindre : rien n’est envoyé, l’annonce repart à la prochaine activation', async () => {
    const announce = vi.spyOn(service, 'announce').mockResolvedValue({ sent: 0, skipped: 0, errors: 0 });
    await service.setEnabled(GiveawayPool.PREMIUM, true);
    expect(await service.setEnabled(GiveawayPool.PREMIUM, false)).toBe(0);
    expect(row).toMatchObject({ premiumEnabled: false, premiumAnnouncedAt: null });
    expect(announce).toHaveBeenCalledTimes(1);
    await service.setEnabled(GiveawayPool.PREMIUM, true);
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('« Tirer maintenant » : seulement hors prod ET GIVEAWAY_MANUAL_DRAW=true', () => {
    expect(service.manualDrawAvailable()).toBe(false);
    env['GIVEAWAY_MANUAL_DRAW'] = 'true';
    expect(service.manualDrawAvailable()).toBe(false); // FRONTEND_URL absent = prod
    env['FRONTEND_URL'] = 'https://app.mytradingcoach.app';
    expect(service.manualDrawAvailable()).toBe(false);
    env['FRONTEND_URL'] = 'https://dev.app.mytradingcoach.app';
    expect(service.manualDrawAvailable()).toBe(true);
  });
});

describe('annonce : destinataires', () => {
  const u = (over: Record<string, unknown>) => ({
    isDemo: false, isInternal: false, role: Role.USER, plan: 'FREE',
    stripeSubscriptionId: null, stripeSubscriptionStatus: null, ...over,
  });

  it('tirage gratuit : comptes gratuits réels seulement', () => {
    const w = announceAudienceWhere(GiveawayPool.FREE);
    expect(matchWhere(u({}), w)).toBe(true);
    expect(matchWhere(u({ isDemo: true }), w)).toBe(false);
    expect(matchWhere(u({ isInternal: true }), w)).toBe(false);
    expect(matchWhere(u({ role: Role.ADMIN }), w)).toBe(false);
    expect(matchWhere(u({ stripeSubscriptionId: 's', stripeSubscriptionStatus: 'active' }), w)).toBe(false);
  });

  it('tirage Premium : abonnés actifs réels seulement', () => {
    const w = announceAudienceWhere(GiveawayPool.PREMIUM);
    expect(matchWhere(u({ stripeSubscriptionId: 's', stripeSubscriptionStatus: 'active' }), w)).toBe(true);
    expect(matchWhere(u({ stripeSubscriptionId: 's', stripeSubscriptionStatus: 'active', isDemo: true }), w)).toBe(false);
    expect(matchWhere(u({}), w)).toBe(false);
  });

  it('le nombre affiché filtre déjà le consentement marketing', async () => {
    await service.announceAudienceCount(GiveawayPool.FREE);
    expect(JSON.stringify(prisma.user.count.mock.calls[0][0].where)).toContain('"marketingConsent":true');
  });
});
