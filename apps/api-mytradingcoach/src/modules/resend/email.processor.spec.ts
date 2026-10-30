import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import type { ResendService } from './resend.service';
import type { EmailJob } from './email-queue';

vi.mock('./resend.service', () => ({ ResendService: class {} }));

const data: EmailJob = { to: 'a@test.com', subject: 's', html: 'h' };
const job = (attemptsMade: number) => ({ id: '42', timestamp: 1791559800101, data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<EmailJob>;

describe('EmailProcessor (SCA-B5-02)', () => {
  it.each([
    [0, false],
    [3, false],
    [4, true],
  ])('essais déjà échoués = %i → dernier essai : %s, clé d’idempotence du job', async (attemptsMade, lastAttempt) => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const processor = new EmailProcessor({ deliver } as unknown as ResendService);

    await processor.process(job(attemptsMade));

    expect(deliver).toHaveBeenCalledWith(data, { lastAttempt, idempotencyKey: 'email/42/1791559800101' });
  });

  it('deux files dont les compteurs se croisent (prod / beta / dev) ne partagent pas la clé', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const processor = new EmailProcessor({ deliver } as unknown as ResendService);

    await processor.process({ ...job(0), timestamp: 1 } as unknown as Job<EmailJob>);
    await processor.process({ ...job(0), timestamp: 2 } as unknown as Job<EmailJob>);

    const [first, second] = deliver.mock.calls.map(([, q]) => q.idempotencyKey);
    expect(first).not.toBe(second);
  });

  it('une erreur passagère remonte pour que BullMQ réessaie', async () => {
    const processor = new EmailProcessor({ deliver: vi.fn().mockRejectedValue(new Error('rate_limit_exceeded')) } as unknown as ResendService);

    await expect(processor.process(job(0))).rejects.toThrow('rate_limit_exceeded');
  });

  it('les en-têtes de désinscription survivent à la file (données sérialisées en JSON par BullMQ, #791)', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const processor = new EmailProcessor({ deliver } as unknown as ResendService);
    const withHeaders: EmailJob = { ...data, headers: { 'List-Unsubscribe': '<https://api.test/u?token=t>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
    const stored = JSON.parse(JSON.stringify(withHeaders)) as EmailJob;
    await processor.process({ id: '7', timestamp: 1, data: stored, attemptsMade: 0, opts: { attempts: 5 } } as unknown as Job<EmailJob>);
    expect(deliver.mock.calls[0][0].headers).toEqual(withHeaders.headers);
  });
});
