import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { AiLoggerService } from './ai-logger.service';
import { RedisService } from './redis.service';
import { AI_THINKING_OFF } from './ai-pricing.const';

/**
 * Texte de la réponse : les blocs `text` mis bout à bout, '' s'il n'y en a pas. Lire par type et
 * non `content[0]` : un modèle qui réfléchit commence par un bloc `thinking`, et un refus
 * (`stop_reason: 'refusal'`) peut revenir sans aucun contenu.
 */
export function responseText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Délai max d'un appel, proportionnel à la réponse demandée : ~30 ms par token de sortie,
 * 60 s minimum. Le défaut du SDK (10 min) bloquait une requête HTTP et son worker bien trop
 * longtemps en cas de panne ; un délai fixe court aurait coupé les gros débriefs (8k tokens).
 */
export function requestTimeoutMs(maxTokens: number): number {
  return Math.max(60_000, maxTokens * 30);
}

// Sémaphore global des appels modèle (SCA-B5-06), tous process et conteneurs confondus : un
// ensemble trié Redis, une entrée par appel en cours (score = échéance). Une entrée oubliée par un
// process tué expire seule.
export const AI_SEMAPHORE_KEY = 'ai:anthropic:inflight';
export const AI_SEMAPHORE_WAIT_MS = 60_000;
const AI_SEMAPHORE_POLL_MS = 250;
// Purge des échues, puis place prise seulement s'il en reste : atomique (un seul script).
const ACQUIRE_LUA = `
redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])
if redis.call('zcard', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('zadd', KEYS[1], ARGV[3], ARGV[4])
  redis.call('pexpire', KEYS[1], ARGV[5])
  return 1
end
return 0`;

/** Appels modèle simultanés autorisés : `AI_MAX_CONCURRENCY`, 4 par défaut. */
export function aiMaxConcurrency(raw = process.env['AI_MAX_CONCURRENCY']): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

@Injectable()
export class AnthropicClientService {
  private readonly logger = new Logger(AnthropicClientService.name);
  // Une seule relance automatique (429 / 5xx / réseau) : au-delà, l'utilisateur attend trop.
  private readonly client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'], maxRetries: 1 });

  constructor(
    private readonly aiLogger: AiLoggerService,
    private readonly redis: RedisService,
  ) {}

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
    // Pas de réflexion sauf demande explicite de l'appelant (cf. AI_THINKING_OFF).
    const thinkingOff = AI_THINKING_OFF[params.model];
    if (thinkingOff && params.thinking === undefined) params = { ...params, thinking: thinkingOff };
    const timeout = requestTimeoutMs(params.max_tokens);
    const slot = await this.acquireSlot(timeout, meta.feature);
    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(params, { timeout });
    } catch (err) {
      // Trace de l'échec (jamais le contenu envoyé, qui contient les données de l'utilisateur).
      const status = (err as { status?: number }).status; // présent sur les erreurs HTTP du SDK
      this.logger.warn(
        `Appel IA en échec : feature=${meta.feature} model=${params.model} ` +
          `status=${status ?? 'réseau/timeout'} durée=${Date.now() - startedAt}ms — ${(err as Error).message}`,
      );
      throw err;
    } finally {
      if (slot) await this.releaseSlot(slot);
    }
    if (response.stop_reason === 'refusal') {
      this.logger.warn(`Appel IA refusé par le modèle : feature=${meta.feature} model=${params.model}`);
    }
    this.aiLogger.log({
      userId: meta.userId,
      feature: meta.feature,
      model: params.model,
      usage: response.usage,
    });
    return response;
  }

  /**
   * Prend une place du sémaphore global, en attendant au plus AI_SEMAPHORE_WAIT_MS. Redis
   * indisponible → on laisse passer (null) : un garde-fou ne doit pas couper toute l'IA.
   */
  private async acquireSlot(callTimeoutMs: number, feature: string): Promise<string | null> {
    const token = randomUUID();
    const ttl = callTimeoutMs + 30_000; // l'appel est coupé avant : la place ne survit pas à un process tué
    const deadline = Date.now() + AI_SEMAPHORE_WAIT_MS;
    try {
      for (;;) {
        const now = Date.now();
        const ok = await this.redis.client.eval(
          ACQUIRE_LUA, 1, AI_SEMAPHORE_KEY, now, aiMaxConcurrency(), now + ttl, token, ttl,
        );
        if (ok === 1) return token;
        if (now >= deadline) break;
        await new Promise((r) => setTimeout(r, AI_SEMAPHORE_POLL_MS + Math.random() * AI_SEMAPHORE_POLL_MS));
      }
    } catch (err) {
      this.logger.warn(`Sémaphore IA indisponible (${String(err)}) : appel sans limite globale`);
      return null;
    }
    this.logger.warn(`IA saturée : feature=${feature}, aucune place libérée en ${AI_SEMAPHORE_WAIT_MS / 1000} s`);
    throw new ServiceUnavailableException("L'IA est très sollicitée, réessaie dans une minute.");
  }

  private async releaseSlot(token: string): Promise<void> {
    try {
      await this.redis.client.zrem(AI_SEMAPHORE_KEY, token);
    } catch {
      /* expirera seule (score = échéance) */
    }
  }
}
