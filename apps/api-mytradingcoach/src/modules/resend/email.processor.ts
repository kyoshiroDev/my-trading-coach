import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ResendService } from './resend.service';
import { EMAIL_QUEUE, EMAIL_RATE_LIMIT, type EmailJob } from './email-queue';

// Vide la file e-mail (SCA-B5-02), worker seulement (SCA-B6-01). Le limiter est global à la file
// (tous les workers et conteneurs réunis), sous les 10 requêtes/s de Resend.
@Processor(EMAIL_QUEUE, { limiter: EMAIL_RATE_LIMIT })
export class EmailProcessor extends WorkerHost {
  constructor(private readonly resend: ResendService) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    // attemptsMade = essais déjà échoués : celui-ci est le dernier quand il atteint attempts − 1.
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.resend.deliver(job.data, { lastAttempt, idempotencyKey: `email/${job.id}` });
  }
}
