import { describe, it, expect, vi } from 'vitest';
import { BehaviorMutesService } from './behavior-mutes.service';

const at = new Date('2026-11-24T10:00:00Z');

function setup() {
  const prisma = {
    behaviorDetectorMute: {
      findMany: vi.fn(async () => [{ detector: 'B_REVENGE', createdAt: at }]),
      upsert: vi.fn(async () => ({ detector: 'C1_LOSS_STREAK', createdAt: at })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { svc: new BehaviorMutesService(prisma as never), prisma };
}

describe('BehaviorMutesService (#671)', () => {
  it('liste en dates ISO', async () => {
    expect(await setup().svc.list('u')).toEqual([{ detector: 'B_REVENGE', createdAt: '2026-11-24T10:00:00.000Z' }]);
  });

  it('couper : upsert idempotent sur (userId, detector), date d’origine gardée', async () => {
    const { svc, prisma } = setup();
    await svc.mute('u', 'C1_LOSS_STREAK');
    expect(prisma.behaviorDetectorMute.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_detector: { userId: 'u', detector: 'C1_LOSS_STREAK' } }, update: {},
    }));
  });

  it('réactiver : deleteMany limité au trader et au détecteur', async () => {
    const { svc, prisma } = setup();
    await svc.unmute('u', 'B_REVENGE');
    expect(prisma.behaviorDetectorMute.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u', detector: 'B_REVENGE' } });
  });

  it('ensemble des détecteurs coupés', async () => {
    expect([...(await setup().svc.mutedSet('u'))]).toEqual(['B_REVENGE']);
  });
});
