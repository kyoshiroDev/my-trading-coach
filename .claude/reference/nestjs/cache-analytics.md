# Cache Redis analytics versionné

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Cache Redis analytics — versionné (SCA-B1-03, 2026-10-07) · 2026-10-07 -->
> **Origine** : `nestjs.md` · « Cache Redis analytics — versionné (SCA-B1-03, 2026-10-07) » · 2026-10-07

## Cache Redis analytics — versionné (SCA-B1-03, 2026-10-07)

`AnalyticsService.withCache(userId, part, ttl, compute)` lit/écrit
`analytics:<userId>:v<n>:<part>`, où `n` = compteur `analytics:v:<userId>` (absent → 0).
- **Invalider = `invalidateUserCache(userId)` = `INCR` + `EXPIRE 7 j` du compteur** (O(1)). Plus de
  SCAN/DEL : les clés de l'ancienne version ne sont plus lues et expirent par leur TTL (300 s).
  Le compteur vit plus longtemps que tout cache : repartir de 0 ne retombe jamais sur une clé vivante.
- Nouvelle clé analytics → passer par `withCache(userId, '<part>', …)`, jamais une clé construite à
  la main (elle échapperait à l'invalidation).
- Redis en panne → calcul direct, rien écrit.
