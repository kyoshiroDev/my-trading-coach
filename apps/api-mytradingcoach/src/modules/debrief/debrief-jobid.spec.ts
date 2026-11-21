import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DebriefCron } from './debrief.cron';
import { DebriefService } from './debrief.service';
import { DebriefAdminController } from './debrief-admin.controller';

/**
 * #1060 : le job du dimanche resté en file (worker en retard, redémarrage) et celui du rattrapage
 * du lundi pouvaient être traités en même temps pour la même semaine → deux e-mails. Les deux
 * portent maintenant le même jobId : BullMQ n'en garde qu'un tant qu'il est en file. Un job du
 * dimanche ÉCHOUÉ (gardé 7 j pour diagnostic) ne doit pas bloquer le rattrapage. Les jobs admin
 * (force) ne partagent jamais cet id.
 */
const real = new DebriefService(null as never, null as never, null as never, null as never);
const service = {
  getEligibleUsers: vi.fn(),
  getWeekInfo: real.getWeekInfo.bind(real),
  lastCompletedWeekRef: real.lastCompletedWeekRef.bind(real),
  weeklyCutoff: real.weeklyCutoff.bind(real),
  weekRefDate: real.weekRefDate.bind(real),
};
const queue = { add: vi.fn(), getJob: vi.fn() };
const prisma = { weeklyDebrief: { findMany: vi.fn().mockResolvedValue([]) } };
const cron = new DebriefCron(prisma as never, service as never, queue as never);

const jobIdOf = (call: unknown[]) => (call[2] as { jobId?: string }).jobId;

describe('Débrief : jobId stable par utilisateur et par semaine (#1060)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); // Date seule : les délais restent réels (règle 1)
    queue.add.mockReset().mockResolvedValue({});
    queue.getJob.mockReset().mockResolvedValue(undefined);
    service.getEligibleUsers.mockReset().mockResolvedValue([{ id: 'u1' }]);
  });
  afterEach(() => vi.useRealTimers());

  it('cron du dimanche 23:00 et rattrapage du lundi 08:00 : même jobId, sans « : »', async () => {
    vi.setSystemTime(new Date('2026-06-28T21:00:00Z')); // dimanche 23:00 Paris (semaine 26)
    await cron.scheduledDebriefs();
    vi.setSystemTime(new Date('2026-06-29T06:00:00Z')); // lundi 08:00 Paris
    await cron.catchUpMissedDebriefs();

    expect(queue.add).toHaveBeenCalledTimes(2);
    const [sunday, monday] = queue.add.mock.calls.map(jobIdOf);
    expect(sunday).toBe('debrief-u1-2026-26');
    expect(monday).toBe(sunday);
  });

  it('rattrapage : job du dimanche ÉCHOUÉ → retiré puis réenfilé', async () => {
    const failed = { getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn().mockResolvedValue(undefined) };
    queue.getJob.mockResolvedValue(failed);
    vi.setSystemTime(new Date('2026-06-29T06:00:00Z'));
    await cron.catchUpMissedDebriefs();

    expect(queue.getJob).toHaveBeenCalledWith('debrief-u1-2026-26');
    expect(failed.remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledOnce();
    expect(failed.remove.mock.invocationCallOrder[0]).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
  });

  it('rattrapage : job du dimanche encore en file → gardé (BullMQ ignore le doublon)', async () => {
    const waiting = { getState: vi.fn().mockResolvedValue('waiting'), remove: vi.fn() };
    queue.getJob.mockResolvedValue(waiting);
    vi.setSystemTime(new Date('2026-06-29T06:00:00Z'));
    await cron.catchUpMissedDebriefs();

    expect(waiting.remove).not.toHaveBeenCalled();
    expect(jobIdOf(queue.add.mock.calls[0])).toBe('debrief-u1-2026-26');
  });

  it('régénération admin (force) : jamais le jobId du cron', async () => {
    const admin = new DebriefAdminController(service as never, queue as never);
    await admin.regenerate({ userId: 'u1', year: 2026, week: 26, force: true } as never);

    expect(queue.add).toHaveBeenCalledOnce();
    expect(jobIdOf(queue.add.mock.calls[0])).toBeUndefined();
  });
});
