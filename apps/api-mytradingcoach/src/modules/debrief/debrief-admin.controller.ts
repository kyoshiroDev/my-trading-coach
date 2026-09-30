import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { DebriefService } from './debrief.service';
import { RegenerateDebriefDto } from './dto/regenerate-debrief.dto';

/** Réservé ADMIN : régénération ciblée d'une semaine de débrief (filet de récupération). */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('debrief/admin')
export class DebriefAdminController {
  constructor(
    private readonly debriefService: DebriefService,
    @InjectQueue('debrief') private readonly debriefQueue: Queue,
  ) {}

  // Régénère la semaine ISO (year, week) pour un user précis ou tous les éligibles.
  // Enqueue des jobs → le processor génère + envoie l'email (si created/forcé).
  @Post('regenerate')
  async regenerate(@Body() body: RegenerateDebriefDto) {
    const { userId, year, week, force = true } = body;
    const refDate = this.debriefService.weekRefDate(year, week);
    const targets = userId
      ? [{ id: userId }]
      : await this.debriefService.getEligibleUsers();

    await Promise.all(
      targets.map((u) =>
        this.debriefQueue.add(
          'generate',
          { userId: u.id, refDate: refDate.toISOString(), force },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: { age: 7 * 24 * 3600, count: 1000 }, // échecs gardés 7 j pour diagnostic, pas indéfiniment
          },
        ),
      ),
    );

    return { queued: targets.length, year, week, force };
  }
}
