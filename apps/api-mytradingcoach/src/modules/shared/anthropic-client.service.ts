import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiLoggerService } from './ai-logger.service';

/**
 * Délai max d'un appel, proportionnel à la réponse demandée : ~30 ms par token de sortie,
 * 60 s minimum. Le défaut du SDK (10 min) bloquait une requête HTTP et son worker bien trop
 * longtemps en cas de panne ; un délai fixe court aurait coupé les gros débriefs (8k tokens).
 */
export function requestTimeoutMs(maxTokens: number): number {
  return Math.max(60_000, maxTokens * 30);
}

@Injectable()
export class AnthropicClientService {
  private readonly logger = new Logger(AnthropicClientService.name);
  // Une seule relance automatique (429 / 5xx / réseau) : au-delà, l'utilisateur attend trop.
  private readonly client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'], maxRetries: 1 });

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
    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(params, { timeout: requestTimeoutMs(params.max_tokens) });
    } catch (err) {
      // Trace de l'échec (jamais le contenu envoyé, qui contient les données de l'utilisateur).
      const status = (err as { status?: number }).status; // présent sur les erreurs HTTP du SDK
      this.logger.warn(
        `Appel IA en échec : feature=${meta.feature} model=${params.model} ` +
          `status=${status ?? 'réseau/timeout'} durée=${Date.now() - startedAt}ms — ${(err as Error).message}`,
      );
      throw err;
    }
    this.aiLogger.log({
      userId: meta.userId,
      feature: meta.feature,
      model: params.model,
      usage: response.usage,
    });
    return response;
  }
}
