import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { PatternAgent } from './pattern.agent';

const mockMessagesCreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({
        patterns: [{ type: 'weakness', title: 'Revenge trading', description: 'Tu trades trop vite après une perte.', badge: 'Attention' }],
        topPattern: 'Revenge trading fréquent',
        emotionInsight: 'STRESSED → win rate 20%.',
      }),
    }],
  }),
);

// APIError must be a static property on the default export so that
// `err instanceof Anthropic.APIError` in handleAnthropicError works.
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    error: unknown;
    constructor(status: number, error: unknown, message: string) {
      super(message);
      this.status = status;
      this.error = error;
    }
  }
  const MockAnthropic = vi.fn().mockImplementation(function () {
    return { messages: { create: mockMessagesCreate } };
  });
  (MockAnthropic as unknown as Record<string, unknown>)['APIError'] = APIError;
  return { default: MockAnthropic, APIError };
});

const validResponse = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      patterns: [{ type: 'weakness', title: 'Revenge trading', description: 'Détecté.', badge: 'Attention' }],
      topPattern: 'Revenge trading fréquent',
      emotionInsight: 'STRESSED → win rate 20%.',
    }),
  }],
};

describe('PatternAgent', () => {
  let agent: PatternAgent;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMessagesCreate.mockResolvedValue(validResponse);

    const module = await Test.createTestingModule({
      providers: [PatternAgent],
    }).compile();

    agent = module.get(PatternAgent);
  });

  it('analyze() retourne les patterns parsés', async () => {
    const result = await agent.analyze('résumé trades...');

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0].type).toBe('weakness');
    expect(result.patterns[0].badge).toBe('Attention');
    expect(result.topPattern).toBe('Revenge trading fréquent');
    expect(result.emotionInsight).toBe('STRESSED → win rate 20%.');
  });

  it('analyze() gère le JSON avec backticks markdown', async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n{"patterns":[],"topPattern":"Aucun","emotionInsight":"N/A"}\n```',
      }],
    });

    const result = await agent.analyze('résumé...');
    expect(result.patterns).toHaveLength(0);
    expect(result.topPattern).toBe('Aucun');
  });

  it('analyze() throw 503 si overloaded_error', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    mockMessagesCreate.mockRejectedValueOnce(
      new APIError(529, { error: { type: 'overloaded_error' } }, 'overloaded'),
    );

    await expect(agent.analyze('résumé...')).rejects.toThrow(HttpException);

    mockMessagesCreate.mockRejectedValueOnce(
      new APIError(529, { error: { type: 'overloaded_error' } }, 'overloaded'),
    );
    try {
      await agent.analyze('résumé...');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(503);
    }
  });
});
