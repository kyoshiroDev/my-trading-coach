# Textes générés par l'IA : conformité et style

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Conformité des textes de l'IA : aucune promesse (#881) · 2026-11-08 -->
> **Origine** : `nestjs.md` · « Conformité des textes de l'IA : aucune promesse (#881) » · 2026-11-08

## Conformité des textes de l'IA : aucune promesse (#881)

MTC ne promet jamais de gain et ne donne aucun conseil d'investissement personnalisé (AMF).
- **Consigne** : `COMPLIANCE_RULE` (`modules/ai/prompts/compliance.prompt.ts`) dans TOUT prompt dont
  la sortie est lue (chat, insights pattern + coach, récap 17h30, débrief, analyses éco, autopsie) :
  décrire le passé et le comportement, jamais ce qui va se passer ; pas de quoi trader ni quand entrer
  ou sortir ; caractère indicatif. Analyses éco : le sentiment bull/bear = réaction habituelle du
  marché, à titre indicatif, pas une prévision.
- **Garde-fou de sortie** : `guardAiText(feature, produce, logger)` (`common/ai-text-guard`) autour de
  chaque génération : une régénération au plus, puis `AI_TEXT_FALLBACK` pour les seules chaînes non
  conformes (JSON contrôlé champ par champ). Journal = nombre et identifiants des motifs, jamais le
  texte. Les textes déjà stockés ne sont jamais réécrits. Hors garde-fou : traductions de news (contenu
  tiers), import CSV (non affiché).
- **Motifs** (`findForbiddenTerms`, sans casse ni accents sauf « sûr » / « entré sur ») : rentable,
  profitable, edge, avantage statistique, garanti / assuré / à coup sûr (sauf négation), futur de
  résultat (« tu vas », « tu seras »…), « améliorer ton taux de réussite », « optimiser tes gains »,
  impératif d'achat / vente (« achète », « vends », « entre sur », « prends ce trade »), trader
  « gagnant / perdant ». Acceptés : « trade gagnant », « bien sûr », « assure-toi de », « tu vends trop
  tôt » (description), négations.
- **Tests** : `ai-text-guard.spec.ts` (motifs, faux positifs), `ai-text-guard-wiring.spec.ts` (câblage,
  modèle simulé), `ai-texts-compliance.spec.ts` (balaie prompts, démo, gabarits, textes de l'app ;
  phrases hors champ autorisées nommément avec leur raison). Aucun appel réel à l'IA.

<!-- Origine : nestjs.md · Style des textes générés : pas de tiret cadratin (PROMPT-174) · 2026-08-16 -->
> **Origine** : `nestjs.md` · « Style des textes générés : pas de tiret cadratin (PROMPT-174) » · 2026-08-16

## Style des textes générés : pas de tiret cadratin (PROMPT-174)

Le tiret cadratin (U+2014) et le demi-cadratin (U+2013) ont été retirés de toute
l'interface : ils se lisent comme une marque de texte généré par IA. Les sorties du
modèle sont lues par l'utilisateur (debrief, patterns, conseils, chat, recap 17h30,
analyses éco, news traduites) : elles ne doivent pas les réintroduire.

**Règle unique** : `NO_EM_DASH_RULE` dans `modules/ai/prompts/style.prompt.ts`.
Tout nouveau prompt dont la sortie est affichée à l'utilisateur doit l'injecter :

```typescript
import { NO_EM_DASH_RULE } from '../prompts/style.prompt';

const MON_SYSTEM = `Tu es …
${NO_EM_DASH_RULE}
Format JSON : { … }`;
```

- Prompt avec bloc `system:` → l'injecter dans le système.
- Prompt sans bloc `system:` (message user seul) → l'injecter dans le prompt user.
- Prompt à sortie **structurée non rédactionnelle** (extraction CSV) → inutile.
- Les 2 caractères sont écrits en **échappement unicode** dans la constante
  (`\u2014` / `\u2013`) : le modèle reçoit le caractère réel, et le contrôle
  `grep -rnP "\x{2014}|\x{2013}" apps/*/src | grep -v spec` reste **vide**.
  Ne jamais les réécrire en littéral.

### Où vivent réellement les prompts

`modules/ai/prompts/` ne contient que `debrief.prompt.ts` et `style.prompt.ts`.
Les autres prompts sont **au plus près de leur agent** :

| Sortie | Prompt | Fichier |
|---|---|---|
| Weekly Debrief | `DEBRIEF_SYSTEM_PROMPT` | `prompts/debrief.prompt.ts` |
| Patterns (IA Insights) | `PATTERN_SYSTEM` | `agents/pattern.agent.ts` |
| Conseils (IA Insights) | `COACH_SYSTEM` | `agents/coach.agent.ts` |
| Chat coach | `CHAT_SYSTEM` (inline) | `ai.service.ts` |
| Recap 17h30 | system inline | `ai.service.ts` |
| Analyses éco | prompt user | `ai.service.ts` |
| Traductions news | prompt user | `trades/market-data.service.ts` |

`CHAT_SYSTEM` est **volontairement inline** et non extrait en constante : il interpole
le profil du trader (`${userContext}`), impossible depuis une constante de module.
C'est la raison pour laquelle l'ancien `prompts/insights.prompt.ts` (1ʳᵉ génération,
pré-multi-agents) a été débranché le 2026-04-27 puis **supprimé** : il est resté 3 mois
en code mort, invisible au compilateur car entièrement `export` (TS/ESLint ne signalent
pas les exports inutilisés). Le relire donnait l'illusion de modifier le chat.
