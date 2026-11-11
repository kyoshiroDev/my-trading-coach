import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EcoCalendarCron } from './eco-calendar.cron';
import { EcoCalendarService } from './eco-calendar.service';
import type { EcoCalendarGateway } from './eco-calendar.gateway';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';
import type { AiService } from '../ai/ai.service';
import type { AnthropicClientService } from '../infra/anthropic-client.service';

/**
 * Relevé planifié des résultats, de bout en bout : vrai service, base EcoEvent en mémoire, FMP
 * simulé (aucun appel réseau), horloge figée.
 */
interface Row {
  date: string; time: string; name: string; country: string; currency: string; impact: string;
  actual: number | null; estimate: number | null; previous: number | null;
  isReleased: boolean; unit: string | null; nameFr: string | null;
}

function inMemoryEcoEvents(rows: Row[]) {
  const matchDate = (d: string, w: unknown): boolean => {
    if (w === undefined) return true;
    if (typeof w === 'string') return d === w;
    const c = w as { in?: string[]; gte?: string; lte?: string };
    if (c.in && !c.in.includes(d)) return false;
    if (c.gte && d < c.gte) return false;
    if (c.lte && d > c.lte) return false;
    return true;
  };
  return {
    rows,
    findMany: vi.fn(async ({ where }: { where: { date?: unknown; actual?: null; nameFr?: null } }) =>
      rows
        .filter((r) => matchDate(r.date, where.date))
        .filter((r) => !('actual' in where) || r.actual === null)
        .filter((r) => !('nameFr' in where) || r.nameFr === null)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((r) => ({ ...r }))),
    upsert: vi.fn(async ({ where, update, create }: {
      where: { date_name_currency: { date: string; name: string; currency: string } };
      update: Partial<Row>; create: Row;
    }) => {
      const k = where.date_name_currency;
      const existing = rows.find((r) => r.date === k.date && r.name === k.name && r.currency === k.currency);
      if (existing) { Object.assign(existing, update); return { ...existing }; }
      const row = { ...create };
      rows.push(row);
      return { ...row };
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
}

const fed = (actual: number | null): Row => ({
  date: '2026-11-04', time: '20:00', name: 'Fed Interest Rate Decision', country: 'US', currency: 'USD',
  impact: 'high', actual, estimate: 3.75, previous: 4, isReleased: actual !== null, unit: '%', nameFr: null,
});

const fmpFed = (actual: number | null) => ({
  date: '2026-11-04 19:00:00', event: 'Fed Interest Rate Decision', country: 'US', currency: 'USD',
  previous: 4, estimate: 3.75, actual, change: null, changePercentage: null, impact: 'High', unit: '%',
});

describe('EcoCalendarCron · relevé planifié', () => {
  let ecoEvent: ReturnType<typeof inMemoryEcoEvents>;
  let gateway: { notifyNewReleases: ReturnType<typeof vi.fn> };
  let cron: EcoCalendarCron;
  let fetchMock: ReturnType<typeof vi.fn>;
  let fmpPayload: unknown[];

  const build = (rows: Row[]) => {
    ecoEvent = inMemoryEcoEvents(rows);
    const prisma = {
      ecoEvent,
      ecoLabelTranslation: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaService;
    const redis = { client: {} } as unknown as RedisService;
    const service = new EcoCalendarService(prisma, {} as AiService, redis, {} as AnthropicClientService);
    gateway = { notifyNewReleases: vi.fn() };
    cron = new EcoCalendarCron(service, gateway as unknown as EcoCalendarGateway);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('FMP_API_KEY', 'test-key');
    vi.stubEnv('NODE_ENV', 'test'); // pas de traduction
    fmpPayload = [];
    // FMP simulé : ne renvoie que les annonces de la plage UTC demandée (from/to inclus).
    fetchMock = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      const [from, to] = [q.get('from') ?? '', q.get('to') ?? ''];
      const data = (fmpPayload as { date: string }[]).filter((e) => e.date.slice(0, 10) >= from && e.date.slice(0, 10) <= to);
      return { ok: true, status: 200, json: async () => data };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('annonce à 20:00 Paris (hiver) : relevée à 20:00:20, résultat stocké et diffusé', async () => {
    vi.setSystemTime(new Date('2026-11-04T19:00:20Z'));
    build([fed(null)]);
    fmpPayload = [fmpFed(3.75)];

    await cron.pollScheduledReleases();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('from=2026-11-03&to=2026-11-05');
    expect(ecoEvent.rows[0].actual).toBe(3.75);
    expect(gateway.notifyNewReleases).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Fed Interest Rate Decision', actual: 3.75, isReleased: true }),
    ]);
  });

  it('résultat pas encore publié : nouvel essai au tick suivant, puis plus rien une fois stocké', async () => {
    vi.setSystemTime(new Date('2026-11-04T19:00:00Z'));
    build([fed(null)]);
    fmpPayload = [fmpFed(null)];
    await cron.pollScheduledReleases();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gateway.notifyNewReleases).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-11-04T19:00:20Z'));
    fmpPayload = [fmpFed(3.75)];
    await cron.pollScheduledReleases();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gateway.notifyNewReleases).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-04T19:00:40Z'));
    await cron.pollScheduledReleases();
    expect(fetchMock).toHaveBeenCalledTimes(2); // résultat en base : plus de requête
  });

  it("annonce à 20:00 Paris en heure d'été : relevée à 18:00 UTC", async () => {
    vi.setSystemTime(new Date('2026-07-29T18:00:20Z'));
    build([{ ...fed(null), date: '2026-07-29' }]);
    fmpPayload = [{ ...fmpFed(4.25), date: '2026-07-29 18:00:00' }];
    await cron.pollScheduledReleases();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ecoEvent.rows[0].actual).toBe(4.25);
  });

  it("jour du passage à l'heure d'hiver (25/10) : annonce de 20:00 relevée à 19:00 UTC, pas à 18:00", async () => {
    build([{ ...fed(null), date: '2026-10-25', name: 'GDP Growth Rate QoQ', currency: 'NZD', country: 'NZ' }]);
    vi.setSystemTime(new Date('2026-10-25T18:00:20Z'));
    await cron.pollScheduledReleases();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-25T19:00:20Z'));
    await cron.pollScheduledReleases();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('annonce de nuit (01:30 Paris) : relevée et stockée', async () => {
    vi.setSystemTime(new Date('2026-11-05T00:30:20Z'));
    build([{
      date: '2026-11-05', time: '01:30', name: 'Employment Change', country: 'AU', currency: 'AUD',
      impact: 'high', actual: null, estimate: 20, previous: 15, isReleased: false, unit: 'K', nameFr: null,
    }]);
    fmpPayload = [{
      date: '2026-11-05 00:30:00', event: 'Employment Change', country: 'AU', currency: 'AUD',
      previous: 15, estimate: 20, actual: 32, change: null, changePercentage: null, impact: 'High', unit: 'K',
    }];
    await cron.pollScheduledReleases();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ecoEvent.rows[0].actual).toBe(32);
    expect(gateway.notifyNewReleases).toHaveBeenCalledTimes(1);
  });

  it('hors fenêtre (avant l’heure, après +15 min, discours, samedi) : aucune requête FMP', async () => {
    build([
      fed(null),
      { ...fed(null), time: '20:30', name: 'Fed Chair Powell Press Conference' },
    ]);
    for (const t of [
      '2026-11-04T12:00:00Z', // mercredi midi, rien de prévu
      '2026-11-04T18:59:40Z', // 20 s avant la Fed
      '2026-11-04T19:15:20Z', // 15 min 20 après
      '2026-11-04T19:31:00Z', // conférence de presse : pas de chiffre
      '2026-11-07T19:00:20Z', // samedi
    ]) {
      vi.setSystemTime(new Date(t));
      await cron.pollScheduledReleases();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rattrapage de 6 h le lundi : le vendredi soir resté sans résultat est resynchronisé', async () => {
    vi.setSystemTime(new Date('2026-11-09T05:00:00Z')); // lundi 6 h Paris
    build([{ ...fed(null), date: '2026-11-06', time: '22:00' }]);
    fmpPayload = [{ ...fmpFed(3.5), date: '2026-11-06 21:00:00' }];

    await cron.prefetchDay();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(3); // lundi, mardi, puis vendredi rattrapé
    expect(urls[2]).toContain('from=2026-11-05&to=2026-11-07');
    expect(ecoEvent.rows.find((r) => r.date === '2026-11-06')?.actual).toBe(3.5);
  });
});
