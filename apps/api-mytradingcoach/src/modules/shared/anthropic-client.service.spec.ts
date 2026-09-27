import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock du SDK Anthropic — function() obligatoire (arrow incompatible avec `new`).
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

import { AnthropicClientService, requestTimeoutMs } from './anthropic-client.service';
import { AiLoggerService } from './ai-logger.service';

describe('AnthropicClientService', () => {
  const prismaCreate = vi.fn().mockResolvedValue({});
  const prisma = { aiUsageLog: { create: prismaCreate } };
  let svc: AnthropicClientService;
  let origEnabled: string | undefined;

  const PARAMS = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'hi' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    origEnabled = process.env['AI_ENABLED'];
    const aiLogger = new AiLoggerService(prisma as never);
    svc = new AnthropicClientService(aiLogger);
  });
  afterEach(() => {
    if (origEnabled !== undefined) process.env['AI_ENABLED'] = origEnabled;
    else delete process.env['AI_ENABLED'];
  });

  it('AI_ENABLED != true → lève sans toucher au SDK ni au log', async () => {
    process.env['AI_ENABLED'] = 'false';
    await expect(
      svc.create(PARAMS as never, { feature: 'news_translation', userId: null }),
    ).rejects.toThrow();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(prismaCreate).not.toHaveBeenCalled();
  });

  it('AI_ENABLED=true → appelle le SDK puis logge modèle + coût au tarif Haiku', async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const res = await svc.create(PARAMS as never, { feature: 'news_translation', userId: null });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(res.usage.output_tokens).toBe(50);
    // Haiku : 1$/Mtok input + 5$/Mtok output → (100*1 + 50*5)/1e6 = 0.00035
    expect(prismaCreate).toHaveBeenCalledWith({
      data: {
        userId: null,
        feature: 'news_translation',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: (100 * 1 + 50 * 5) / 1_000_000,
      },
    });
  });

  it('passe un délai max proportionnel à max_tokens (60 s minimum)', async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockResolvedValueOnce({ content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    await svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' });
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), { timeout: 60_000 });
    expect(requestTimeoutMs(8192)).toBe(245_760);
  });

  it("échec du SDK : relancé tel quel, rien n'est facturé dans le journal d'usage", async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }));
    await expect(svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' })).rejects.toThrow('overloaded');
    expect(prismaCreate).not.toHaveBeenCalled();
  });
});
