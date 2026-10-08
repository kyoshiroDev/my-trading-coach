import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import type { ResendService } from './resend.service';
import type { EmailJob } from './email-queue';

vi.mock('./resend.service', () => ({ ResendService: class {} }));

const data: EmailJob = { to: 'a@test.com', subject: 's', html: 'h' };
const job = (attemptsMade: number) => ({ id: '42', data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<EmailJob>;

describe('EmailProcessor (SCA-B5-02)', () => {
  it.each([
    [0, false],
    [3, false],
    [4, true],
  ])('essais déjà échoués = %i → dernier essai : %s, clé d’idempotence du job', async (attemptsMade, lastAttempt) => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const processor = new EmailProcessor({ deliver } as unknown as ResendService);

    await processor.process(job(attemptsMade));

    expect(deliver).toHaveBeenCalledWith(data, { lastAttempt, idempotencyKey: 'email/42' });
  });

  it('une erreur passagère remonte pour que BullMQ réessaie', async () => {
    const processor = new EmailProcessor({ deliver: vi.fn().mockRejectedValue(new Error('rate_limit_exceeded')) } as unknown as ResendService);

    await expect(processor.process(job(0))).rejects.toThrow('rate_limit_exceeded');
  });
});
