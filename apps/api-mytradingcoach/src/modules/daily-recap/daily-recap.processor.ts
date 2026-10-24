import { Optional } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { userAmountsCurrency } from '../../common/utils/user-currency.util';
import { DailyRecapService } from './daily-recap.service';
import { TraderNotifier } from '../push/trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from '../push/trader-push-messages';
import { DAILY_RECAP_CONCURRENCY, DAILY_RECAP_QUEUE, type DailyRecapJob } from './daily-recap.queue';

// Génère le récap d'un utilisateur et met son e-mail en file (SCA-B5-01). Worker seulement.
// Un nouvel essai refait le même récap : `generateRecap` fait un upsert sur (userId, date).
@Processor(DAILY_RECAP_QUEUE, { concurrency: DAILY_RECAP_CONCURRENCY })
export class DailyRecapProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRecapService: DailyRecapService,
    private readonly resend: ResendService,
    /** Push « récap prêt » (#666), coupé par défaut chez le trader. */
    @Optional() private readonly notifier?: TraderNotifier,
  ) {
    super();
  }

  async process(job: Job<DailyRecapJob>): Promise<void> {
    const { userId, at } = job.data;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) return; // compte supprimé entre le cron et le traitement

    const recap = await this.dailyRecapService.generateRecap(userId, new Date(at));
    if (recap && recap.tradesCount > 0) {
      await this.resend.sendDailyRecap(user, recap, await userAmountsCurrency(this.prisma, userId));
      this.notifier?.notify(userId, 'RECAP', TRADER_PUSH_MESSAGES.recapReady(), { dedupKey: `recap:${at}` });
    }
  }
}
