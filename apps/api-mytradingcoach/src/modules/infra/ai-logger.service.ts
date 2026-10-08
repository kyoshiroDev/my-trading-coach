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
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };
  }): void {
    const inputTokens = opts.usage.input_tokens;
    const outputTokens = opts.usage.output_tokens;
    // Le palier de prix (Haiku 5.5 au-delà de 100K) se juge sur le prompt entier, cache compris.
    const promptTokens =
      inputTokens + (opts.usage.cache_read_input_tokens ?? 0) + (opts.usage.cache_creation_input_tokens ?? 0);
    // Coût au tarif réel du modèle appelé (Haiku ≠ Sonnet) : cf. ai-pricing.const.ts
    const cost = costUsd(opts.model, inputTokens, outputTokens, promptTokens);

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
