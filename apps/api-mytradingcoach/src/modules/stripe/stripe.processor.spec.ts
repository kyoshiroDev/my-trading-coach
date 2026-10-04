import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { StripeProcessor } from './stripe.processor';
import type { StripeWebhookService } from './stripe-webhook.service';
import type { StripeWebhookJobPayload } from './stripe.types';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/nestjs', () => sentry);

function job(over: { attemptsMade?: number; attempts?: number } = {}): Job<StripeWebhookJobPayload> {
  return {
    id: 'job-1',
    data: { event: { id: 'evt_1', type: 'invoice.paid' } },
    attemptsMade: over.attemptsMade ?? 0,
    opts: { attempts: over.attempts },
  } as unknown as Job<StripeWebhookJobPayload>;
}

describe('StripeProcessor', () => {
  const processWebhookEvent = vi.fn();
  const processor = new StripeProcessor({ processWebhookEvent } as unknown as StripeWebhookService);

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('process : transmet l’événement au service', async () => {
    await processor.process(job());
    expect(processWebhookEvent).toHaveBeenCalledWith({ id: 'evt_1', type: 'invoice.paid' });
  });

  it('process : une erreur du service remonte (BullMQ relance le job)', async () => {
    processWebhookEvent.mockRejectedValueOnce(new Error('boom'));
    await expect(processor.process(job())).rejects.toThrow('boom');
  });

  it('onCompleted : ne lève pas', () => {
    expect(() => processor.onCompleted(job())).not.toThrow();
  });

  it('onFailed : sans job, ne fait rien', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://x@sentry.invalid/1');
    await processor.onFailed(undefined, new Error('x'));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('onFailed : tentatives restantes → pas d’alerte Sentry', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://x@sentry.invalid/1');
    await processor.onFailed(job({ attemptsMade: 2, attempts: 5 }), new Error('x'));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('onFailed : dernière tentative → alerte Sentry avec le type et l’id de l’événement', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://x@sentry.invalid/1');
    const err = new Error('définitif');
    await processor.onFailed(job({ attemptsMade: 5, attempts: 5 }), err);
    expect(sentry.captureException).toHaveBeenCalledWith(err, { tags: { eventType: 'invoice.paid', eventId: 'evt_1' } });
  });

  it('onFailed : dernière tentative sans SENTRY_DSN → pas d’envoi', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    await processor.onFailed(job({ attemptsMade: 5 }), new Error('x'));
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
