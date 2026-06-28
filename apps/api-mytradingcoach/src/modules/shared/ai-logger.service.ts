import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { costUsd } from './ai-pricing.const';

@Injectable()
export class AiLoggerService {
  private readonly logger = new Logger(AiLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(opts: {
    userId: string | null;
    feature: string;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  }): void {
    const inputTokens = opts.usage.input_tokens;
    const outputTokens = opts.usage.output_tokens;
    // Coût au tarif réel du modèle appelé (Haiku ≠ Sonnet) — cf. ai-pricing.const.ts
    const cost = costUsd(opts.model, inputTokens, outputTokens);

    this.prisma.aiUsageLog
      .create({
        data: {
          userId: opts.userId,
          feature: opts.feature,
          model: opts.model,
          inputTokens,
          outputTokens,
          costUsd: cost,
        },
      })
      .catch((err: Error) => this.logger.warn(`AiUsageLog skipped: ${err.message}`));
  }
}
