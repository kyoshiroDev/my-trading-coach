import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Queue } from 'bullmq';
import { DailyRecapCron } from './daily-recap.cron';
import type { PrismaService } from '../../prisma/prisma.service';
import { DAILY_RECAP_JOB_OPTIONS, dailyRecapJobId, type DailyRecapJob } from './daily-recap.queue';

describe('DailyRecapCron (SCA-B5-01)', () => {
  const findMany = vi.fn();
  const addBulk = vi.fn();
  const cron = new DailyRecapCron(
    { user: { findMany } } as unknown as PrismaService,
    { addBulk } as unknown as Queue<DailyRecapJob>,
  );

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    addBulk.mockReset().mockResolvedValue([]);
  });

  it('enfile un job par utilisateur, id stable par jour, sans rien générer ni envoyer', async () => {
    await cron.generateDailyRecaps();

    const jobs = addBulk.mock.calls[0][0] as Array<{ data: DailyRecapJob; opts: { jobId: string } }>;
    expect(jobs.map((j) => j.data.userId)).toEqual(['u1', 'u2']);
    expect(jobs[0].opts).toMatchObject({ ...DAILY_RECAP_JOB_OPTIONS, jobId: dailyRecapJobId('u1', new Date(jobs[0].data.at)) });
  });

  it('cible les Premium non démo qui ont tradé aujourd’hui', async () => {
    await cron.generateDailyRecaps();

    expect(findMany.mock.calls[0][0].where).toMatchObject({ isDemo: false, plan: 'PREMIUM' });
  });

  it('relancé le même jour → mêmes ids de jobs (BullMQ n’enfile pas de doublon)', async () => {
    await cron.generateDailyRecaps();
    await cron.generateDailyRecaps();

    const ids = addBulk.mock.calls.map((c) => (c[0] as Array<{ opts: { jobId: string } }>).map((j) => j.opts.jobId));
    expect(ids[1]).toEqual(ids[0]);
  });
});

describe('dailyRecapJobId', () => {
  it('jour de Paris, sans « : » (refusé par BullMQ)', () => {
    // 23 h 30 UTC le 6 octobre = 1 h 30 le 7 à Paris.
    expect(dailyRecapJobId('u1', new Date('2026-10-06T23:30:00Z'))).toBe('recap-u1-2026-10-07');
    expect(dailyRecapJobId('u1', new Date())).not.toContain(':');
  });
});
