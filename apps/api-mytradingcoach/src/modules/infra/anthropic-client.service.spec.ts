import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock du SDK Anthropic — function() obligatoire (arrow incompatible avec `new`).
const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () {
    return { messages: { create: mockCreate } };
  }),
}));

import { AI_SEMAPHORE_KEY, AI_SEMAPHORE_WAIT_MS, AnthropicClientService, aiMaxConcurrency, requestTimeoutMs, responseText } from './anthropic-client.service';
import { AI_MODELS } from './ai-pricing.const';
import { AiLoggerService } from './ai-logger.service';

describe('AnthropicClientService', () => {
  const prismaCreate = vi.fn().mockResolvedValue({});
  const prisma = { aiUsageLog: { create: prismaCreate } };
  let svc: AnthropicClientService;
  let origEnabled: string | undefined;
  const redis = { client: { eval: vi.fn(), zrem: vi.fn() } };

  const PARAMS = {
    model: AI_MODELS.fast,
    max_tokens: 10,
    messages: [{ role: 'user', content: 'hi' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    origEnabled = process.env['AI_ENABLED'];
    const aiLogger = new AiLoggerService(prisma as never);
    redis.client.eval.mockReset().mockResolvedValue(1);
    redis.client.zrem.mockReset().mockResolvedValue(1);
    svc = new AnthropicClientService(aiLogger, redis as never);
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
    // Haiku 5.5 : 0,10 $/Mtok input + 0,50 $/Mtok output → (100*0.1 + 50*0.5)/1e6
    expect(prismaCreate).toHaveBeenCalledWith({
      data: {
        userId: null,
        feature: 'news_translation',
        model: AI_MODELS.fast,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: (100 * 0.1 + 50 * 0.5) / 1_000_000,
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

  it('Haiku 5.5 sans `thinking` précisé → envoyé sans réflexion ; un réglage explicite est respecté', async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockResolvedValue({ content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    await svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' });
    expect(mockCreate.mock.calls[0][0].thinking).toEqual({ type: 'disabled' });

    await svc.create({ ...PARAMS, thinking: { type: 'adaptive' } } as never, { feature: 'chat', userId: 'u1' });
    expect(mockCreate.mock.calls[1][0].thinking).toEqual({ type: 'adaptive' });

    await svc.create({ ...PARAMS, model: 'mystery-model-9' } as never, { feature: 'chat', userId: 'u1' });
    expect(mockCreate.mock.calls[2][0]).not.toHaveProperty('thinking');
  });

  it('modèle d’analyse (Sonnet 4.6) : requête envoyée telle quelle, sans champ thinking', async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockResolvedValue({ content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    const params = { ...PARAMS, model: AI_MODELS.analysis };
    await svc.create(params as never, { feature: 'chat', userId: 'u1' });
    expect(AI_MODELS.analysis).toBe('claude-sonnet-4-6');
    expect(mockCreate.mock.calls[0][0]).toEqual(params);
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('thinking');
  });

  it('cache compris dans le prompt : au-delà de 100K, palier long de Haiku 5.5', async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0 },
    });
    await svc.create(PARAMS as never, { feature: 'csv_import', userId: 'u1' });
    expect(prismaCreate.mock.calls[0][0].data.costUsd).toBeCloseTo((1_000 * 0.5 + 100 * 2.5) / 1_000_000, 12);
  });

  it('responseText : lit les blocs texte par type, vide sur un refus sans contenu', () => {
    const msg = (content: unknown[]) => ({ content }) as never;
    expect(responseText(msg([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"a":1}' }]))).toBe('{"a":1}');
    expect(responseText(msg([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))).toBe('ab');
    expect(responseText(msg([]))).toBe('');
  });

  it("échec du SDK : relancé tel quel, rien n'est facturé dans le journal d'usage", async () => {
    process.env['AI_ENABLED'] = 'true';
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }));
    await expect(svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' })).rejects.toThrow('overloaded');
    expect(prismaCreate).not.toHaveBeenCalled();
  });

  describe('sémaphore global (SCA-B5-06)', () => {
    beforeEach(() => {
      process.env['AI_ENABLED'] = 'true';
      mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } });
    });
    afterEach(() => vi.useRealTimers());

    it('prend une place avant l’appel et la rend après, même en échec', async () => {
      await svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' });
      expect(redis.client.eval.mock.calls[0]).toEqual(expect.arrayContaining([AI_SEMAPHORE_KEY, aiMaxConcurrency()]));
      const token = redis.client.eval.mock.calls[0][6]; // (script, 1, clé, now, max, échéance, jeton, ttl)
      expect(redis.client.zrem).toHaveBeenCalledWith(AI_SEMAPHORE_KEY, token);

      mockCreate.mockRejectedValueOnce(new Error('boom'));
      await expect(svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' })).rejects.toThrow('boom');
      expect(redis.client.zrem).toHaveBeenCalledTimes(2);
    });

    it('aucune place libérée en 60 s → 503, le modèle n’est pas appelé', async () => {
      vi.useFakeTimers();
      redis.client.eval.mockResolvedValue(0);
      const call = svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' });
      const assertion = expect(call).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(AI_SEMAPHORE_WAIT_MS + 1_000);
      await assertion;
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('Redis indisponible → l’appel passe sans limite globale', async () => {
      redis.client.eval.mockRejectedValue(new Error('down'));
      await expect(svc.create(PARAMS as never, { feature: 'chat', userId: 'u1' })).resolves.toBeDefined();
      expect(redis.client.zrem).not.toHaveBeenCalled();
    });

    it('AI_MAX_CONCURRENCY : entier positif, sinon 4', () => {
      expect(aiMaxConcurrency('8')).toBe(8);
      expect(aiMaxConcurrency(undefined)).toBe(4);
      expect(aiMaxConcurrency('0')).toBe(4);
      expect(aiMaxConcurrency('abc')).toBe(4);
    });
  });
});
