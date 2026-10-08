import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parseAnthropicJson } from './parse-json.util';
import { handleAnthropicError } from './anthropic-errors.util';
import {
  buildDebriefPrompt,
  DEBRIEF_SYSTEM_PROMPT,
} from '../prompts/debrief.prompt';
import { AnthropicClientService, responseText } from '../../infra/anthropic-client.service';
import { AI_MODELS } from '../../infra/ai-pricing.const';

/**
 * Budget de sortie du débrief : base + marge par compte, plafonné (un seul appel, coût maîtrisé
 * même avec plusieurs comptes). 4096 tronquait l'analyse détaillée des users multi-comptes
 * → JSON invalide. Relevé de 25 % le 2026-10-08 (2000 + 900/compte, plafond 8192 → 2500 +
 * 1125/compte, plafond 10240) : sur Sonnet 4.6, un débrief à 2 comptes sortait jusqu'à
 * 3 230 jetons sur 3 800 (85 %). Gratuit tant que le plafond n'est pas atteint : seuls les
 * jetons produits sont facturés.
 */
export function debriefMaxTokens(accountCount: number): number {
  return Math.min(10_240, 2_500 + accountCount * 1_125);
}

@Injectable()
export class DebriefAgent {
  private readonly logger = new Logger(DebriefAgent.name);

  constructor(private readonly anthropicClient: AnthropicClientService) {}

  async generate(
    data: Parameters<typeof buildDebriefPrompt>[0],
    userId?: string,
  ): Promise<unknown> {
    // Aucun appel modèle (payant) hors production, sauf opt-in explicite AI_DEBRIEF_DEV=true.
    // Stub structuré valide : debrief.service lit overview?.summary et reconstruit les
    // sections par compte depuis la BDD (accounts:[] → onglets sans texte IA, pas de crash).
    if (
      process.env['NODE_ENV'] !== 'production' &&
      process.env['AI_DEBRIEF_DEV'] !== 'true'
    ) {
      return { overview: { summary: '(débrief IA disponible en production)' }, accounts: [] };
    }

    const maxTokens = debriefMaxTokens(data.accounts?.length ?? 1);

    let response: Anthropic.Message;
    try {
      response = await this.anthropicClient.create(
        {
          model: AI_MODELS.analysis,
          max_tokens: maxTokens,
          system: [
            {
              type: 'text',
              text: DEBRIEF_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: buildDebriefPrompt(data) }],
        },
        { feature: 'debrief', userId: userId ?? null },
      );
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    const text = responseText(response);
    if (!text) {
      throw new HttpException(
        'Réponse IA invalide',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      return parseAnthropicJson(text);
    } catch {
      this.logger.error('Failed to parse debrief AI response', text);
      throw new HttpException(
        'Réponse IA invalide',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
