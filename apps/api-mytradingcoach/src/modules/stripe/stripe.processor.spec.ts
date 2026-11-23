import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { StripeProcessor, stackWithoutMessage } from './stripe.processor';
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

/** #1251 : webhook échoué : nom de l'erreur et lignes « at … » de la pile, jamais le message. */
describe('StripeProcessor.onFailed — journal sans le message de l’erreur (#1251)', () => {
  afterEach(() => vi.restoreAllMocks());

  const leaky = () => {
    const err = Object.assign(new Error('No such customer: client@exemple.test\nsuite du message'), { name: 'StripeInvalidRequestError' });
    err.stack = [
      'StripeInvalidRequestError: No such customer: client@exemple.test',
      'suite du message',
      '    at StripeWebhookService.handle (stripe-webhook.service.ts:10:5)',
      '    at async StripeProcessor.process (stripe.processor.ts:30:7)',
    ].join('\n');
    return err;
  };

  it('stackWithoutMessage : nom puis lignes « at », message multiligne retiré', () => {
    expect(stackWithoutMessage(leaky())).toBe([
      'StripeInvalidRequestError',
      '    at StripeWebhookService.handle (stripe-webhook.service.ts:10:5)',
      '    at async StripeProcessor.process (stripe.processor.ts:30:7)',
    ].join('\n'));
  });

  it('onFailed : message et pile journalisés sans l’adresse', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const processor = new StripeProcessor({ processWebhookEvent: vi.fn() } as unknown as StripeWebhookService);
    await processor.onFailed(job({ attemptsMade: 1, attempts: 5 }), leaky());
    const [message, stack] = error.mock.calls[0].map(String);
    expect(message).toBe('Webhook échoué (1/5 tentatives) | type: invoice.paid, id: evt_1 : StripeInvalidRequestError');
    expect(stack).toContain('at StripeWebhookService.handle');
    // Contre-épreuve : ni la première ligne de la pile ni la suite du message.
    expect(`${message}\n${stack}`).not.toMatch(/client@exemple\.test|suite du message/);
  });
});
