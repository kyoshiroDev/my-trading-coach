import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DebriefCron } from './debrief.cron';

const mockQueue = { add: vi.fn() };
const mockPrisma = { weeklyDebrief: { findMany: vi.fn() } };
const mockService = {
  getEligibleUsers: vi.fn(),
  lastCompletedWeekRef: vi.fn(),
  getWeekInfo: vi.fn(),
};

const cron = new DebriefCron(
  mockPrisma as never,
  mockService as never,
  mockQueue as never,
);

describe('DebriefCron — rattrapage lundi', () => {
  const ref = new Date('2026-06-22T12:00:00'); // semaine 26

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.lastCompletedWeekRef.mockReturnValue(ref);
    mockService.getWeekInfo.mockReturnValue({ weekNumber: 26, year: 2026 });
  });

  it('enqueue uniquement les éligibles SANS débrief de la semaine passée', async () => {
    mockService.getEligibleUsers.mockResolvedValue([
      { id: 'u1', email: 'a@x' },
      { id: 'u2', email: 'b@x' },
    ]);
    mockPrisma.weeklyDebrief.findMany.mockResolvedValue([{ userId: 'u1' }]); // u1 déjà servi

    await cron.catchUpMissedDebriefs();

    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'generate',
      { userId: 'u2', refDate: ref.toISOString(), force: false },
      expect.anything(),
    );
  });

  it('tout le monde a déjà son débrief → aucun job', async () => {
    mockService.getEligibleUsers.mockResolvedValue([{ id: 'u1', email: 'a@x' }]);
    mockPrisma.weeklyDebrief.findMany.mockResolvedValue([{ userId: 'u1' }]);

    await cron.catchUpMissedDebriefs();

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('aucun éligible → aucun job, pas de requête débrief', async () => {
    mockService.getEligibleUsers.mockResolvedValue([]);

    await cron.catchUpMissedDebriefs();

    expect(mockPrisma.weeklyDebrief.findMany).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});

describe('DebriefCron — dimanche', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueue un job par éligible avec refDate=maintenant et force=false', async () => {
    mockService.getEligibleUsers.mockResolvedValue([
      { id: 'u1', email: 'a@x' },
      { id: 'u2', email: 'b@x' },
    ]);

    await cron.scheduledDebriefs();

    expect(mockQueue.add).toHaveBeenCalledTimes(2);
    const [, payload] = mockQueue.add.mock.calls[0];
    expect(payload.userId).toBe('u1');
    expect(payload.force).toBe(false);
    expect(typeof payload.refDate).toBe('string');
  });
});
