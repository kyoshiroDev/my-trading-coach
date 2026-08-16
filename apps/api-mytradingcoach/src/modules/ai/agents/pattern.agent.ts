import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parseAnthropicJson } from './parse-json.util';
import { handleAnthropicError } from './anthropic-errors.util';
import { AnthropicClientService } from '../../shared/anthropic-client.service';
import { NO_EM_DASH_RULE } from '../prompts/style.prompt';

export type InsightType = 'strength' | 'weakness' | 'pattern';

export interface Pattern {
  type: InsightType;
  title: string;
  description: string;
  badge: 'Force' | 'Attention' | 'Pattern';
}

export interface PatternAnalysis {
  patterns: Pattern[];
  topPattern: string;
  emotionInsight: string;
}

const PATTERN_SYSTEM = `Tu es un analyste quantitatif de trading.
Tu identifies les patterns comportementaux significatifs et les corrélations émotion/performance.
Réponds TOUJOURS en JSON valide. Jamais de markdown.
LONGUEUR STRICTE : chaque champ texte = 1 seule phrase, 12 mots maximum, pas de saut de ligne.
${NO_EM_DASH_RULE}
Format :
{
  "patterns": [{ "type": "strength"|"weakness"|"pattern", "title": "string (5 mots max)", "description": "string (1 phrase, 12 mots max)", "badge": "Force"|"Attention"|"Pattern" }],
  "topPattern": "string (1 phrase, 12 mots max)",
  "emotionInsight": "string (1 phrase, 12 mots max)"
}`;

@Injectable()
export class PatternAgent {
  private readonly logger = new Logger(PatternAgent.name);

  constructor(private readonly anthropicClient: AnthropicClientService) {}

  async analyze(summary: string, userId?: string): Promise<PatternAnalysis> {
    let response: Anthropic.Message;
    try {
      response = await this.anthropicClient.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: [
            {
              type: 'text',
              text: PATTERN_SYSTEM,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: summary }],
        },
        { feature: 'insights', userId: userId ?? null },
      );
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new HttpException(
        'Réponse IA invalide',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    try {
      return parseAnthropicJson(block.text) as PatternAnalysis;
    } catch {
      this.logger.error('Failed to parse AI response', block.text);
      throw new HttpException(
        'Réponse IA invalide',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
