import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parseAnthropicJson } from './parse-json.util';
import { handleAnthropicError } from './anthropic-errors.util';

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
Format :
{
  "patterns": [{ "type": "strength"|"weakness"|"pattern", "title": "string", "description": "string (2-3 phrases max, sans saut de ligne)", "badge": "Force"|"Attention"|"Pattern" }],
  "topPattern": "string (le pattern principal identifié en 1 phrase)",
  "emotionInsight": "string (corrélation émotion → performance en 1-2 phrases)"
}`;

@Injectable()
export class PatternAgent {
  private readonly anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  private readonly logger = new Logger(PatternAgent.name);

  async analyze(summary: string): Promise<PatternAnalysis> {
    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: [{ type: 'text', text: PATTERN_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: summary }],
      });
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      return parseAnthropicJson(block.text) as PatternAnalysis;
    } catch {
      this.logger.error('Failed to parse AI response', block.text);
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
