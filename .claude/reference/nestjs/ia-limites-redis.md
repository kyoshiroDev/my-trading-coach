# Limites IA via Redis

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Limites IA via Redis · 2026-04-25 -->
> **Origine** : `nestjs.md` · « Limites IA via Redis » · 2026-04-25

## Limites IA via Redis

```typescript
// Cooldown 4h — insights : réservé en UNE opération (SET NX EX, S4 #1045), retiré si
// l'analyse échoue ou si le quota mensuel est atteint (C3 #1045, releaseInsightsCooldown).
async checkInsightsCooldown(userId: string) {
  const key = `ai:cooldown:insights:${userId}`;
  const reserved = await this.redis.set(key, '1', 'EX', 60 * 60 * 4, 'NX');
  if (reserved !== 'OK') {
    const ttl = await this.redis.ttl(key);
    throw new HttpException(
      `Analyse déjà effectuée. Réessaie dans ${Math.ceil(ttl / 60)} minute(s).`, 429
    );
  }
}

// Limite journalière — chat (50/jour) et debrief (1/jour). Appel IA en échec → place rendue
// par `releaseDailyLimit(userId, action)` (C2, C10 #1045).
async checkDailyLimit(userId: string, action: string, max: number) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `ai:limit:${userId}:${action}:${today}`;
  const count = await this.redis.incr(key);
  await this.redis.expire(key, 60 * 60 * 24);
  if (count > max) {
    throw new HttpException(
      `Limite atteinte : ${max} ${action} par jour. Reviens demain.`, 429
    );
  }
}
```

**Quota mensuel réservé, pas compté après (SCA-B5-06, 2026-10-07)** : `AiService.metered(userId, call)`
fait `INCR ai:calls:<user>:<mois>` **avant** l'appel ; > `AI_MONTHLY_QUOTA` → `DECR` + 429 ; appel en
échec → `DECR` (place rendue). Insights et chat passent par là (admin exempté). Avant : vérifier puis
incrémenter après coup laissait 20 appels simultanés dépasser le quota. Redis down → 503 (inchangé).

**Sémaphore global des appels modèle (SCA-B5-06)** : `AnthropicClientService.create` (point d'entrée
unique) prend une place dans l'ensemble trié Redis `ai:anthropic:inflight` (script Lua atomique,
place = jeton + échéance, expire seule si le process meurt) ; **`AI_MAX_CONCURRENCY`** places (défaut
**4**) tous process confondus ; attente ≤ 60 s puis 503 « L'IA est très sollicitée ». Redis down → on
laisse passer. Les gros débriefs (jusqu'à ~4 min) tiennent une place : si le chat sature le
dimanche soir, monter `AI_MAX_CONCURRENCY`. Les 429 Anthropic : le SDK (`maxRetries: 1`) respecte
déjà `retry-after` ; prompt caching déjà posé (`cache_control`) sur les system prompts.
