import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiLoggerService {
  private readonly logger = new Logger(AiLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(userId: string, feature: string, usage: { input_tokens: number; output_tokens: number }): void {
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    // claude-sonnet-4-6 : $3/Mtok input, $15/Mtok output
    const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    this.prisma.aiUsageLog
      .create({ data: { userId, feature, inputTokens, outputTokens, costUsd } })
      .catch((err: Error) => this.logger.warn(`AiUsageLog skipped: ${err.message}`));
  }
}
