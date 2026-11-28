# Modèle de coût IA

> Contenu déplacé à l'identique depuis `.claude/agents/plans.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : plans.md · Modèle de coût IA (règle de tiérage) · 2026-07-04 -->
> **Origine** : `plans.md` · « Modèle de coût IA (règle de tiérage) » · 2026-07-04

## Modèle de coût IA (règle de tiérage)
On tiér par **structure de coût**, PAS par « IA vs pas d'IA ».

- **MUTUALISÉ** — coût O(signatures d'actifs / clés partagées), indépendant du nb de users → **FREE** :
  - Contexte marché : 1 clé Redis partagée `market:context` (TTL).
  - Calendrier éco : cache BDD `ecoAnalysisCache` par `(date, assetsKey)`, journalisé `userId: null` (job
    mutualisé ; `'shared'` violait la clé étrangère et n'était jamais compté dans AiUsageLog, #920).
  - Calendrier éco, résultats publiés (#920) : génération automatique des annonces **fortes chiffrées**, un
    appel par (jour, événement, signature d'actifs) sous verrou Redis, pour les signatures vues aujourd'hui
    ou hier (compte démo exclu) ; plafond `ECO_RESULT_ANALYSIS_DAILY_MAX` (200/jour par défaut) ; jamais
    hors production. Le clic réutilise le même cache.
  - News : `marketNews` partagé (cron) ; traduction Haiku **1×/article**, `userId:null`, cachée.
- **BORNÉ** — 1/user/période, `max_tokens` capé → **PREMIUM** :
  - Weekly Debrief : 1/user/semaine (au plus 2 si un débrief manuel de milieu de semaine est refait le dimanche, C1 #1048). `max_tokens` = min(10 240, 2 500 + 1 125 × comptes)
    (`debriefMaxTokens`, relevé de 25 % le 2026-10-08 : à 2 comptes, Sonnet 4.6 montait à 85 % de 3 800).
- **Exception assumée : chatbot de support** (#493, ticket révisé par Greg le 2026-10-22, « Ouvert à tous… exception
  assumée ») → **GRATUIT, visiteurs de la landing compris**, borné : base locale d'abord (aucun appel IA), réponse sur
  une prop firm lue dans le catalogue (aucun appel), Haiku seulement en repli, `max_tokens` 400, prompt système en
  cache ; quotas 30 questions/jour (connecté), 10/jour par IP hachée (visiteur et compte démo) ; plafond global
  `HELP_CHAT_DAILY_LLM_MAX` (500/jour par défaut, ≈ 0,0005 $ l'appel, ≈ 0,25 $/jour au plafond), alerte e-mail
  interne à 80 % ; `AiUsageLog` `feature: 'help_chat'`, `userId: null` même connecté (coût de support mutualisé, hors quota IA personnel) ; IA éteinte (`AI_ENABLED`) = réponse simulée, aucun appel.
- **SCALE AVEC L'USAGE** — O(users × engagement) → **PREMIUM** :
  - Chat coach, IA Insights à la demande, recap quotidien.
- L'import IA (broker inconnu → Anthropic, gardé `NODE_ENV=production`) est une IA **personnelle** → **PREMIUM**.
  **Coût mesuré** (2026-09-28) : l'import passe d'abord par un chemin **mapping** où le modèle
  déduit la correspondance des colonnes sur 20 lignes (`csv-mapping.ts`), puis le code parse le
  fichier entier. **Un seul appel, ≈ 0,003 $ en modèle rapide, indépendant de la taille du
  fichier** — contre ≈ 1,43 $ pour 2000 lignes quand le modèle rédigeait chaque trade. Le chemin
  mapping est donc tenté AVANT le plafond `MAX_AI_ROWS`.
  Le sens (long/short) n'est **jamais** pris sur parole : mesuré 3/5 seulement pour les deux
  modèles, il est tranché par le signe du P&L. Si la forme ne tient pas, si trop de lignes sont
  inexploitables, ou si le sens n'est pas vérifiable (export sans prix d'entrée, type Binance
  Futures), on **retombe sur l'ancien chemin ligne par ligne** — `AI_BATCH` = **25** lignes, borne
  de sortie et non de coût : jusqu'à ~140 jetons de JSON par trade (mesuré le 2026-10-08, colonne de
  notes remplie), contre `max_tokens: 8192`. À 120 lignes, Sonnet 4.6 atteignait le plafond et l'import
  échouait ; à 25, le pire lot mesuré tient en 37 % du plafond (règle : ≤ 50 %, testée).
  Ordre de grandeur : 1000 imports gratuits de 2000 lignes ≈ **3 $** par mapping, contre
  ≈ 1430 $ par l'ancien chemin. Le taux de repli pilote la facture : un repli coûte 186 fois
  un mapping réussi. Ne pas ouvrir l'import IA au FREE sans surveiller ce taux, ni sans quota
  (il n'en existe aucun sur l'import à ce jour, le quota IA mensuel ne couvre que chat/insights).
  **Depuis le 2026-09-28, un broker debloque une fois ne coute plus rien** : sa fiche est
  enregistree au registre (`BrokerCsvMapping`), consultee AVANT le verrou Premium, et sert
  donc tous les plans en parsing local. On paie **par broker** (~0,003 $ une fois, a la
  validation par un admin dans `/brokers`), plus par utilisateur. C'est cette bascule qui
  rendra l'ouverture de l'import aux comptes FREE tenable : le catalogue se remplit a partir
  des fichiers que les utilisateurs envoient, au lieu de couter a chaque import.
  Prealable toujours valable avant d'ouvrir aux FREE : il n'existe **aucun quota sur l'import**.

**Modèle par appel** — `AI_MODELS.fast` (**Haiku 5.5**, `claude-haiku-5-5`) pour les tâches courtes et
fréquentes : traductions news, contexte marché, mapping des CSV inconnus, **et les deux appels du
calendrier éco** (depuis le 2026-09-28). Le calendrier éco est la **seule IA qu'un compte FREE peut déclencher**, donc la seule dont
le coût suit l'audience : il n'a rien à faire sur `analysis`. Son coût ne suit pas le nombre d'users mais
le nombre de **signatures d'actifs distinctes** (cache partagé par `(date, assetsKey)`, top 5 actifs du
trader) — ≈ 0,0002 $ l'appel en Haiku 5.5. `analysis` (**Sonnet 4.6**, `claude-sonnet-4-6`) reste pour le
chat, le recap quotidien, le débrief, les insights et les lots d'import CSV inconnu, tous PREMIUM.

**Sonnet 5.5 : testé le 2026-10-08, pas adopté, à retenter plus tard.** Qualité au moins égale et 2 / 10 $
au lieu de 3 / 15 $, mais deux blocages mesurés sur de vrais appels : le **chat coach est coupé** (il
ignore « 3-5 phrases », ~420-500 tokens contre `max_tokens: 512`, ni l'effort `low`/`medium` ni une
consigne renforcée ne règlent le problème) et le **débrief** a renvoyé un JSON illisible **1 fois sur 8**.
Pour le retenter : revoir le plafond du chat et la robustesse du JSON du débrief (sorties structurées).
Sur Sonnet 5.5, `thinking: disabled` est une 400 : couper la réflexion avec `between_tools`.

**Tarifs** (USD / million de tokens, `MODEL_PRICING` dans `modules/infra/ai-pricing.const.ts`) :
Haiku 5.5 = 0,10 entrée / 0,50 sortie jusqu'à 100K tokens de prompt, **0,50 / 2,50 sur tout l'appel
au-delà** (`longPrompt`, jugé sur le prompt cache compris) ; Sonnet 4.6 = 3 / 15. Avant le 2026-10-08 :
Haiku 4.5 = 1 / 5. Haiku 5.5 produit **~25-50 % de tokens en plus** pour le même texte (mesuré :
×1,25 à ×1,48 en entrée selon le prompt) : raisonner en coût par appel, pas en prix au token.

**Coût IA réel constaté** (prod, 30 j au 2026-10-08) : **14,63 USD facturés** (Cost API), dont 13,80 $
de traductions (`eco_translation` 8,38 $ pour 4 834 appels, `news_translation` 5,41 $). Projection avec
Haiku 5.5 (Sonnet 4.6 inchangé) sur les mêmes volumes, tokenizer inclus : **≈ 2,3 $ / mois (-84 %)**,
dont ≈ 1,8 $ de traductions.
Le coût IA n'est PAS un sujet ; ne pas sur-optimiser. Autoritatif = Anthropic Cost Report API.
