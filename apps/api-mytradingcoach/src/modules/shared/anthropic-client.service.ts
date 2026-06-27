import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiLoggerService } from './ai-logger.service';

@Injectable()
export class AnthropicClientService {
  private readonly client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

  constructor(private readonly aiLogger: AiLoggerService) {}

  // Garde unique : explicite, indépendant de NODE_ENV (le Dev tourne en NODE_ENV=production).
  get enabled(): boolean {
    return process.env['AI_ENABLED'] === 'true';
  }

  /**
   * Point d'entrée UNIQUE pour tout appel modèle. Garde + log automatique (modèle + prix réel).
   * @param feature  ex: 'chat', 'insights', 'debrief', 'daily_recap', 'eco_calendar',
   *                 'csv_import', 'news_translation', 'eco_translation'
   * @param userId   null pour les jobs système (traductions/crons).
   */
  async create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    meta: { feature: string; userId: string | null },
  ): Promise<Anthropic.Message> {
    if (!this.enabled) {
      // En prod AI_ENABLED=true → jamais atteint. En Dev/CI → zéro dépense.
      throw new ServiceUnavailableException(
        'IA désactivée sur cet environnement (AI_ENABLED!=true)',
      );
    }
    const response = await this.client.messages.create(params);
    this.aiLogger.log({
      userId: meta.userId,
      feature: meta.feature,
      model: params.model,
      usage: response.usage,
    });
    return response;
  }
}
