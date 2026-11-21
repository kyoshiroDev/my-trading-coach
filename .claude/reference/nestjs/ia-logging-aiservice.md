# AiService : logging automatique et essai

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · AiService — logging automatique obligatoire · 2026-05-15 -->
> **Origine** : `nestjs.md` · « AiService — logging automatique obligatoire » · 2026-05-15

## AiService — logging automatique obligatoire

Après CHAQUE appel Anthropic dans `AiService`, logger la consommation :

```typescript
await this.prisma.aiUsageLog.create({
  data: {
    userId: options.userId,
    feature: options.feature ?? 'unknown',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: (response.usage.input_tokens * 3 + response.usage.output_tokens * 15) / 1_000_000,
  },
});
```

Toujours passer `{ userId, feature }` dans les options. Features valides :
`'insights'` | `'chat'` | `'debrief'` | `'csv_import'` | `'daily_recap'` | `'eco_calendar'` | `'giveaway_instagram'` (légende Instagram d'un gagnant du tirage, `userId: null`)
