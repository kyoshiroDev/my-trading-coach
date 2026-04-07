import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BillingService } from './billing.service';
import { WebhookJobPayload } from './billing.types';

// ── Processor BullMQ — Traitement async des webhooks Stripe ──────────────────
//
// Ce processor tourne en arrière-plan et traite les events Stripe de façon
// asynchrone. BullMQ gère automatiquement les retries avec backoff exponentiel.
//
// Retry policy (définie dans BillingService.handleWebhook) :
//   - Jusqu'à 5 tentatives
//   - Backoff exponentiel à partir de 5s (5s → 10s → 20s → 40s → 80s)
//   - removeOnFail: false → les jobs échoués restent dans la queue pour inspection

@Processor('billing')
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(private readonly billingService: BillingService) {
    super();
  }

  async process(job: Job<WebhookJobPayload>): Promise<void> {
    const { event } = job.data;

    this.logger.log(
      `Processing webhook — type: ${event.type}, id: ${event.id}, attempt: ${job.attemptsMade + 1}`,
    );

    await this.billingService.processWebhookEvent(event);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<WebhookJobPayload>): void {
    this.logger.log(
      `Webhook traité avec succès — type: ${job.data.event.type}, id: ${job.data.event.id}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJobPayload> | undefined, error: Error): void {
    if (!job) return;
    const { event } = job.data;

    this.logger.error(
      `Webhook échoué (${job.attemptsMade}/${job.opts.attempts ?? '?'} tentatives) — type: ${event.type}, id: ${event.id} : ${error.message}`,
      error.stack,
    );

    // 🔴 Si toutes les tentatives sont épuisées → alerter
    const maxAttempts = job.opts.attempts ?? 5;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(
        `[MONITORING CRITIQUE] Job ${job.id} définitivement échoué — event: ${event.type} [${event.id}]. Inspection manuelle requise.`,
      );
      // 📌 TODO production : Sentry.captureException(error) ou alerte Slack
    }
  }
}
