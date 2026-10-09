import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { DailyRecapProcessor } from './daily-recap.processor';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DailyRecapService } from './daily-recap.service';
import type { ResendService } from '../resend/resend.service';
import type { DailyRecapJob } from './daily-recap.queue';

vi.mock('../../common/utils/user-currency.util', () => ({ userAmountsCurrency: vi.fn().mockResolvedValue('USD') }));

describe('DailyRecapProcessor (SCA-B5-01)', () => {
  const findUnique = vi.fn();
  const generateRecap = vi.fn();
  const sendDailyRecap = vi.fn();
  const processor = new DailyRecapProcessor(
    { user: { findUnique } } as unknown as PrismaService,
    { generateRecap } as unknown as DailyRecapService,
    { sendDailyRecap } as unknown as ResendService,
  );
  const job = { data: { userId: 'u1', at: '2026-10-07T15:30:00.000Z' } } as Job<DailyRecapJob>;
  const user = { email: 'a@test.com', name: 'A' };

  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue(user);
    generateRecap.mockReset().mockResolvedValue({ tradesCount: 2 });
    sendDailyRecap.mockReset().mockResolvedValue(undefined);
  });

  it('génère le récap du jour de la passe du cron puis met l’e-mail en file', async () => {
    await processor.process(job);

    expect(generateRecap).toHaveBeenCalledWith('u1', new Date('2026-10-07T15:30:00.000Z'));
    expect(sendDailyRecap).toHaveBeenCalledWith(user, { tradesCount: 2 }, 'USD');
  });

  it('pas de trade (ou récap vide) → pas d’e-mail', async () => {
    generateRecap.mockResolvedValue(null);
    await processor.process(job);
    expect(sendDailyRecap).not.toHaveBeenCalled();
  });

  it('compte supprimé entre-temps → rien, sans erreur', async () => {
    findUnique.mockResolvedValue(null);
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(generateRecap).not.toHaveBeenCalled();
  });

  it('échec de génération → l’erreur remonte (nouvel essai BullMQ)', async () => {
    generateRecap.mockRejectedValue(new Error('IA indisponible'));
    await expect(processor.process(job)).rejects.toThrow('IA indisponible');
  });
});
