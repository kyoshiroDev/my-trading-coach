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
    // L'id seul ne suffit pas : c'est un compteur par Redis (prod, beta, dev, local repartent chacun
    // de 1), et Resend refuse une clé déjà vue sous 24 h avec un autre contenu → e-mail abandonné
    // (récap du 2026-10-09). La date de création du job, fixe d'un essai à l'autre, la rend unique.
    await this.resend.deliver(job.data, { lastAttempt, idempotencyKey: `email/${job.id}/${job.timestamp}` });
  }
}
