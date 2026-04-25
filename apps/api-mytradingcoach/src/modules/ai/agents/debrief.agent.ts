import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parseAnthropicJson } from './parse-json.util';
import { handleAnthropicError } from './anthropic-errors.util';
import { buildDebriefPrompt, DEBRIEF_SYSTEM_PROMPT } from '../prompts/debrief.prompt';

@Injectable()
export class DebriefAgent {
  private readonly anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  private readonly logger = new Logger(DebriefAgent.name);

  async generate(data: Parameters<typeof buildDebriefPrompt>[0]): Promise<unknown> {
    let response: Anthropic.Message;
    try {
      response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: [{ type: 'text', text: DEBRIEF_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildDebriefPrompt(data) }],
      });
    } catch (err) {
      handleAnthropicError(err, this.logger);
    }

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    try {
      return parseAnthropicJson(block.text);
    } catch {
      this.logger.error('Failed to parse debrief AI response', block.text);
      throw new HttpException('Réponse IA invalide', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
