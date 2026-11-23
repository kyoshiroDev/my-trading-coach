import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { freezeClock } from '../../test/freeze-clock';
import { NewsShieldService, newsSpamKey } from './news-shield.service';
import { newsSlotKey } from './behavior-news';

// Dates fixes : horloge figée (règle du dépôt). NFP du vendredi 04/12/2026 à 14:30 Paris (13:30 UTC).
const NOW = new Date('2026-12-04T13:26:00Z');
const NFP_ROW = { date: '2026-12-04', time: '14:30', name: 'Nonfarm Payrolls (Nov)', nameFr: null, currency: 'USD' };
const BCE_ROW = { date: '2026-12-04', time: '14:28', name: 'ECB Interest Rate Decision', nameFr: null, currency: 'EUR' };

/** Redis en mémoire, `SET NX` atomique (une seule clé gagne, même en parallèle). */
function memoryRedis(positions: Record<string, unknown>) {
  const keys = new Map<string, string>();
  return {
    keys,
    client: {
      get: vi.fn(async (k: string) => (k.startsWith('tradovate:positions:') ? JSON.stringify(positions[k.split(':')[2]] ?? null) : keys.get(k) ?? null)),
      set: vi.fn(async (k: string, v: string, ..._args: unknown[]) => (keys.has(k) ? null : (keys.set(k, v), 'OK'))),
    },
  };
}

function setup(opts: { rows?: object[]; users?: object[]; positions?: Record<string, unknown> } = {}) {
  const prisma = {
    ecoEvent: { findMany: vi.fn().mockResolvedValue(opts.rows ?? [NFP_ROW]) },
    user: { findMany: vi.fn().mockResolvedValue(opts.users ?? [{ id: 'u1', newsShieldMinutes: null }]) },
    behaviorAlert: { create: vi.fn().mockResolvedValue({ id: 'ba1' }) },
  };
  const redis = memoryRedis(opts.positions ?? { c1: { at: NOW.toISOString(), positions: [{ asset: 'NQ', side: 'LONG', quantity: 1 }] } });
  const notifier = { notify: vi.fn() };
  const svc = new NewsShieldService(prisma as never, redis as never, notifier as never);
  const events: { e: string; p: unknown }[] = [];
  const emitFor = () => (e: string, p: unknown) => events.push({ e, p });
  return { svc, prisma, redis, notifier, events, emitFor };
}
const OWNED = [{ userId: 'u1', connectionId: 'c1', accountId: 'a1' }];

describe('NewsShieldService (#670)', () => {
  freezeClock(NOW);
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['NEWS_SHIELD_ENABLED'];
  });
  const on = () => { process.env['NEWS_SHIELD_ENABLED'] = 'true'; };

  it('interrupteur absent : aucun tick (éteint par défaut)', async () => {
    const { svc, prisma, events } = setup();
    expect(await svc.tick(NOW, OWNED, () => () => events.push({ e: '', p: null }))).toBe(0);
    expect(prisma.ecoEvent.findMany).not.toHaveBeenCalled();
  });

  it('position déjà ouverte avant l’annonce : enregistrée, émise (news:alert) et poussée', async () => {
    on();
    const { svc, prisma, notifier, events, emitFor } = setup();
    expect(await svc.tick(NOW, OWNED, emitFor)).toBe(1);
    expect(prisma.behaviorAlert.create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', accountId: 'a1', type: 'D1_NEWS_WINDOW', message: 'Nonfarm Payrolls dans 4 min, position ouverte sur NQ.' });
    expect(events).toEqual([{ e: 'news:alert', p: expect.objectContaining({ id: 'ba1', accountId: 'a1', type: 'D1_NEWS_WINDOW' }) }]);
    expect(notifier.notify).toHaveBeenCalledWith('u1', 'BEHAVIOR', expect.objectContaining({ title: 'Annonce à venir' }), expect.objectContaining({ accountId: 'a1' }));
  });

  it('heure de Paris convertie en UTC, changement d’heure compris (NFP de mars, 13:30 Paris en heure d’hiver)', async () => {
    on();
    const { svc } = setup({ rows: [{ ...NFP_ROW, date: '2026-03-06' }] });
    const [e] = await svc.upcoming(new Date('2026-03-06T13:26:00Z'));
    expect(e.at.toISOString()).toBe('2026-03-06T13:30:00.000Z');
    const summer = setup({ rows: [{ ...NFP_ROW, date: '2026-04-03' }] }).svc;
    const [s] = await summer.upcoming(new Date('2026-04-03T12:26:00Z'));
    expect(s.at.toISOString()).toBe('2026-04-03T12:30:00.000Z');
  });

  it('une alerte par compte et par annonce : pas de deuxième après une alerte à l’entrée, même en parallèle', async () => {
    on();
    const { svc, redis, prisma, emitFor } = setup();
    redis.keys.set(newsSpamKey('a1', newsSlotKey(new Date('2026-12-04T13:30:00Z'), ['USD'])), '1'); // alerte déjà partie à l'entrée
    expect(await svc.tick(NOW, OWNED, emitFor)).toBe(0);
    expect(prisma.behaviorAlert.create).not.toHaveBeenCalled();

    const b = setup();
    const [x, y] = await Promise.all([
      new NewsShieldService(b.prisma as never, b.redis as never).tick(NOW, OWNED, b.emitFor),
      new NewsShieldService(b.prisma as never, b.redis as never).tick(NOW, OWNED, b.emitFor),
    ]);
    expect(x + y).toBe(1);
    expect(b.prisma.behaviorAlert.create).toHaveBeenCalledTimes(1);
  });

  it('compte démo exclu, bouclier coupé (0) : rien', async () => {
    on();
    const demo = setup({ users: [] }); // la requête groupée exclut isDemo
    expect(await demo.svc.tick(NOW, OWNED, demo.emitFor)).toBe(0);
    expect(demo.prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ isDemo: false });
    const off = setup({ users: [{ id: 'u1', newsShieldMinutes: 0 }] });
    expect(await off.svc.tick(NOW, OWNED, off.emitFor)).toBe(0);
  });

  it('annonce d’une devise qui ne concerne pas l’actif ignorée ; aucune annonce dans 30 min : sortie sans lire Redis', async () => {
    on();
    const eur = setup({ rows: [BCE_ROW] });
    expect(await eur.svc.tick(NOW, OWNED, eur.emitFor)).toBe(0);
    const none = setup({ rows: [{ ...NFP_ROW, time: '18:00' }] });
    expect(await none.svc.tick(NOW, OWNED, none.emitFor)).toBe(0);
    expect(none.redis.client.get).not.toHaveBeenCalled();
    expect(none.prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('annonces relues au plus une fois par minute', async () => {
    on();
    const { svc, prisma } = setup();
    await svc.upcoming(NOW);
    await svc.upcoming(new Date(NOW.getTime() + 30_000));
    expect(prisma.ecoEvent.findMany).toHaveBeenCalledTimes(1);
    await svc.upcoming(new Date(NOW.getTime() + 61_000));
    expect(prisma.ecoEvent.findMany).toHaveBeenCalledTimes(2);
  });

  it('erreur pendant le tick : journalisée (nom seulement), jamais propagée ; tick en cours = tick suivant sauté', async () => {
    on();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc, prisma, emitFor } = setup();
    prisma.user.findMany.mockRejectedValueOnce(new TypeError('base u1@exemple.test'));
    expect(await svc.tick(NOW, OWNED, emitFor)).toBe(0);
    expect(String(warn.mock.calls[0][0])).toBe('Bouclier annonces non évalué : TypeError');

    let release!: () => void;
    prisma.user.findMany.mockImplementationOnce(() => new Promise((r) => { release = () => r([{ id: 'u1', newsShieldMinutes: null }]); }));
    const first = svc.tick(NOW, OWNED, emitFor);
    await new Promise((r) => setImmediate(r));
    expect(await svc.tick(NOW, OWNED, emitFor)).toBe(0); // sauté
    release();
    expect(await first).toBe(1);
  });
});
