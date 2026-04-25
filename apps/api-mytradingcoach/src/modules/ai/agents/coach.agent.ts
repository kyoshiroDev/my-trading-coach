import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parseAnthropicJson } from './parse-json.util';
import { handleAnthropicError } from './anthropic-errors.util';
import { Pattern } from './pattern.agent';

export interface Advice {
  title: string;
  description: string;
  priority: 'high' | 'medium';
}

const COACH_SYSTEM = `Tu es un coach de trading bienveillant mais direct.
Tu transformes des patterns détectés en conseils concrets et actionnables.
Tutoiement. Maximum 3 conseils prioritaires.
Réponds TOUJOURS en JSON valide. Jamais de markdown.
Format JSON : { "advice": [{ "title": "string", "description": "string (2-3 phrases, sans saut de ligne)", "priority": "high"|"medium" }] }`;

@Injectable()
export class CoachAgent {
  private readonly anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  private readonly logger = new Logger(CoachAgent.name);

  async generateAdvice(data: { patterns: Pattern[]; summary: string }): Promise<Advice[]> {
    const userContent = `Patterns détectés :\n${JSON.stringify(data.patterns)}\n\nRésumé trader :\n${data.summary}`;

    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      const parsed = parseAnthropicJson(block.text) as { advice: Advice[] };
      return parsed.advice ?? [];
    } catch {
      this.logger.error('Failed to parse coach response', block.text);
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
