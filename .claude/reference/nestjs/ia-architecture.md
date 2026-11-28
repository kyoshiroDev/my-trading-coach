# Architecture multi-agents IA

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Architecture Multi-Agents IA · 2026-04-25 -->
> **Origine** : `nestjs.md` · « Architecture Multi-Agents IA » · 2026-04-25

## Architecture Multi-Agents IA

### Principe
5 agents spécialisés coordonnés par un orchestrateur.
Chaque agent a un seul rôle, un prompt système court et précis.

```
src/modules/ai/agents/
├── orchestrator.agent.ts  ← coordonne, ne fait PAS d'appel Anthropic
├── data.agent.ts          ← calcul pur, ZÉRO appel Anthropic
├── pattern.agent.ts       ← détecte les patterns comportementaux
├── coach.agent.ts         ← génère les conseils actionnables
└── debrief.agent.ts       ← rapport hebdomadaire
```

### data.agent.ts — résumé pré-calculé (ZÉRO token)

```typescript
buildTradesSummary(trades: Trade[]): string {
  const closed = trades.filter(t => t.pnl !== null);
  const wins = closed.filter(t => t.pnl > 0);
  const winRate = closed.length
    ? (wins.length / closed.length * 100).toFixed(1) : '0';
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0).toFixed(2);

  const group = (key: keyof Trade) => {
    const map = new Map<string, Trade[]>();
    trades.forEach(t => {
      const k = String(t[key]);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    });
    return map;
  };

  const statLine = (map: Map<string, Trade[]>) =>
    [...map.entries()]
      .map(([k, ts]) => `${k}:${ts.filter(t=>t.pnl>0).length}W/${ts.filter(t=>t.pnl<=0).length}L`)
      .join(', ');

  const top5 = closed
    .sort((a,b) => Math.abs(b.pnl)-Math.abs(a.pnl))
    .slice(0,5)
    .map(t => `${t.asset} ${t.side} ${t.setup} ${t.emotion} PnL:${t.pnl}`)
    .join(' | ');

  return `
RÉSUMÉ (${trades.length} trades, ${closed.length} clôturés)
WinRate:${winRate}% | PnL:$${totalPnl}
Émotions: ${statLine(group('emotion'))}
Setups: ${statLine(group('setup'))}
Sessions: ${statLine(group('session'))}
Top: ${top5}`.trim();
}
```

### pattern.agent.ts — détection patterns

```typescript
const PATTERN_SYSTEM = `Tu es un analyste quantitatif de trading.
Tu identifies UNIQUEMENT les patterns comportementaux statistiquement significatifs.
Réponds TOUJOURS en JSON valide. Jamais de markdown.
Format : { "patterns": [{ "type": string, "title": string, "description": string, "severity": "info"|"warn"|"alert", "badge": string }] }`;

async analyze(summary: string): Promise<Pattern[]> {
  const res = await this.anthropic.messages.create({
    model: AI_MODELS.analysis, // jamais un identifiant en dur : modules/infra/ai-pricing.const.ts
    max_tokens: 1024,
    system: [{ type: 'text', text: PATTERN_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: summary }]
  });
  return JSON.parse(this.clean(responseText(res))).patterns; // jamais content[0] (bloc thinking, refus)
}
```

### coach.agent.ts — conseils actionnables

```typescript
const COACH_SYSTEM = `Tu es un coach de trading bienveillant mais direct.
Tu transformes des patterns détectés en conseils concrets et actionnables.
Ton de coach, pas d'analyste. Tutoiement. Maximum 3 conseils prioritaires.
Réponds en JSON : { "advice": [{ "title": string, "description": string, "priority": "high"|"medium" }] }`;
```

### orchestrator.agent.ts — coordination

```typescript
async runInsightsFlow(userId: string) {
  // Étape 1 — Data (0 token)
  const trades = await this.tradesService.findAll(userId, { limit: 50 });
  // Pseudo-code : getHistory renvoie des entrées légères sans contenu IA depuis #959 (DebriefHistoryItem).
  const history = await this.debriefService.getHistory(userId);
  const summary = this.dataAgent.buildTradesSummary(trades);

  // Étape 2 — Pattern (1 appel Anthropic, résultat final gardé 4 h dans Redis `ai:insights:last:<userId>`, relu par GET /ai/cooldown (C4 #1046))
  const patterns = await this.patternAgent.analyze(summary);

  // Étape 3 — Coach (1 appel Anthropic)
  const advice = await this.coachAgent.generateAdvice({ patterns, summary, history });

  return { patterns, advice };
}
```

### debrief.agent.ts — rapport hebdomadaire

```typescript
const DEBRIEF_SYSTEM = `Tu es un coach de trading expert. Tu génères des rapports
hebdomadaires synthétiques, bienveillants et actionnables.
Format JSON strict :
{
  "summary": "2-3 phrases coach direct",
  "strengths": [{ "badge": "Force|Très bien", "text": string }],
  "weaknesses": [{ "badge": "Critique|Attention", "text": string }],
  "emotionInsight": "corrélation émotion → performance",
  "objectives": [{ "title": string, "reason": string }]
}`;
```
