import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DebriefService } from './debrief.service';

@Processor('debrief')
export class DebriefProcessor extends WorkerHost {
  private readonly logger = new Logger(DebriefProcessor.name);

  constructor(private debriefService: DebriefService) {
    super();
  }

  async process(job: Job<{ userId: string }>) {
    this.logger.log(`Processing debrief for user ${job.data.userId}`);
    await this.debriefService.generateForUser(job.data.userId);
    this.logger.log(`Debrief generated for user ${job.data.userId}`);
  }
}