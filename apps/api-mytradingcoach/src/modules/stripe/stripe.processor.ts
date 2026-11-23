import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StripeWebhookService } from './stripe-webhook.service';
import { STRIPE_QUEUE } from './stripe.helpers';
import { StripeWebhookJobPayload } from './stripe.types';

/**
 * Pile d'appels sans le message de l'erreur (#1251) : la première ligne d'une pile recopie le
 * message (Prisma ou Stripe : identifiant, e-mail), parfois sur plusieurs lignes. On ne garde que
 * le nom de l'erreur et les lignes « at … », utiles au diagnostic.
 */
export function stackWithoutMessage(error: Error): string {
  const frames = (error.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l));
  return [error.name, ...frames].join('\n');
}

// ── Processor BullMQ : Traitement async des webhooks Stripe ──────────────────
//
// Ce processor tourne en arrière-plan et traite les events Stripe de façon
// asynchrone. BullMQ gère automatiquement les retries avec backoff exponentiel.
//
// Retry policy (définie dans StripeWebhookService.handleWebhook) :
//   - Jusqu'à 5 tentatives
//   - Backoff exponentiel à partir de 5s (5s → 10s → 20s → 40s → 80s)
//   - removeOnFail: false → les jobs échoués restent dans la queue pour inspection

@Processor(STRIPE_QUEUE)
export class StripeProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeProcessor.name);

  constructor(private readonly webhooks: StripeWebhookService) {
    super();
  }

  async process(job: Job<StripeWebhookJobPayload>): Promise<void> {
    const { event } = job.data;

    this.logger.log(
      `Processing webhook | type: ${event.type}, id: ${event.id}, attempt: ${job.attemptsMade + 1}`,
    );

    await this.webhooks.processWebhookEvent(event);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<StripeWebhookJobPayload>): void {
    this.logger.log(
      `Webhook traité avec succès | type: ${job.data.event.type}, id: ${job.data.event.id}`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<StripeWebhookJobPayload> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const { event } = job.data;

    this.logger.error(
      `Webhook échoué (${job.attemptsMade}/${job.opts.attempts ?? '?'} tentatives) | type: ${event.type}, id: ${event.id} : ${error.name}`,
      stackWithoutMessage(error),
    );

    // 🔴 Si toutes les tentatives sont épuisées → alerter
    const maxAttempts = job.opts.attempts ?? 5;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(
        `[MONITORING CRITIQUE] Job ${job.id} définitivement échoué | event: ${event.type} [${event.id}]. Inspection manuelle requise.`,
      );
      if (process.env['SENTRY_DSN']) {
        const Sentry = await import('@sentry/nestjs');
        Sentry.captureException(error, {
          tags: { eventType: event.type, eventId: event.id },
        });
      }
    }
  }
}
