---
name: plans
description: "Source de vérité des plans FREE/PREMIUM : prix, essai, features gatées, coût IA. À lire pour toute tâche touchant prix, accès par plan ou quotas (landing, front, guard, cron)."
---

# Agent Plans — Tarification, paliers & gating

## Rôle
**Source de vérité unique** pour les plans, prix, quotas, la matrice feature×plan et le gating.
Toute feature gated DOIT être cohérente aux **4 endroits** (voir Règle d'or). En cas de doute sur « qui a accès à quoi, à quel prix, gated comment » → c'est ici, pas éparpillé dans les autres agents.

> **Bascule PROMPT-169** : le palier **STARTER a été supprimé**. Il ne reste que **FREE** et **PREMIUM**.
> Ce qui était « Starter » se répartit désormais : l'**IA mutualisée** (contexte marché, calendrier éco, news) descend en **FREE** ; la **profondeur d'analyse** (analytics avancés, Weekly Debrief, Score trader, export, multi-comptes) monte en **PREMIUM**. Aucun abonné payant au moment de la bascule → pas de grandfathering.

---

## Sources de vérité (code)
- **Prix affichés** : `apps/app-mytradingcoach/src/app/core/constants/pricing.const.ts` (`PRICING`, `ACCOUNT_LIMITS`) **+** landing `apps/landing-mytradingcoach/src/components/Pricing.astro`. Les VALEURS viennent de `libs/shared/src/pricing.ts` (`@mtc/shared`) ; les `pricing.const.ts` de l'API (`PRICING_EUR`, `TRIAL_PERIOD_DAYS`, MRR) et de l'admin en dérivent. La lib + la landing + le JSON-LD (`Base.astro`) + les CGU DOIVENT afficher les mêmes montants.
- **Facturation** : price IDs Stripe en env — `STRIPE_PREMIUM_PRICE_MONTHLY_V2` / `_YEARLY_V2` (les vars `STRIPE_STARTER_*` ont été supprimées). ⚠️ Les **montants réels vivent dans Stripe** (pas en dur backend) → vérifier que `_V2` = **49€ / 490€**.
- **Quotas comptes** : `apps/api-mytradingcoach/src/modules/accounts/accounts.service.ts` (`FREE_ACCOUNT_LIMIT` 1 · Premium `null` = illimité). Miroir front `ACCOUNT_LIMITS` (`free: 1`, `premium: null`).
  Seuls les comptes **ACTIVE** consomment le quota : Validé, Échoué et Archivé libèrent la place.
  **Compte perdu (#677, #681)** : fonctionnalité **non gatée** (tous plans). La nouvelle tentative
  (`POST /accounts/:id/retry`) applique le même quota qu'une création : un FREE qui a marqué son seul
  compte comme échoué peut repartir, puisque l'échoué a libéré la place. Les comptes échoués et
  archivés sortent des statistiques « tous les comptes » quel que soit le plan (`includeInactive`
  pour les réinclure) ; la règle ne change rien au gating des analytics Premium.
  **Autopsie d'un compte grillé (#669)** : chronologie, distance à la limite et 3 constats en
  **Gratuit** (zéro IA) ; **analyse IA en Premium** (une par incident, `max_tokens` 400, persistée,
  jamais régénérée, jamais hors prod ni pour la démo). Perte du jour : métrique Premium, donc incident
  `daily_loss` en Premium seulement ; le plancher vaut pour tous.
- **Trades FREE** : **illimités** — le quota mensuel (`checkMonthlyLimit` / `FREE_LIMIT_REACHED`) a été **supprimé**.
- **Essai** : `TRIAL_PERIOD_DAYS = 30` (api pricing.const). Accordé **uniquement** sur le prix **mensuel** ET si `!user.trialUsed`. L'annuel est facturé immédiatement, sans essai.

---

## Les 2 paliers

| | Prix | Trades | Comptes | Essai |
|---|---|---|---|---|
| **FREE** | 0€ · sans CB | illimité | 1 | – |
| **PREMIUM** | 49€/mois · 490€/an (−98€) | illimité | illimité | 30 j (mensuel uniquement, carte requise) |

---

## Principe de gating — RÈGLE FONDAMENTALE
> **On ne verrouille JAMAIS la vue de ses propres données. On verrouille la PROFONDEUR d'analyse.**

- **FREE = le *quoi* (+ IA mutualisée)** : voir ses chiffres et ses vues de base (courbe d'équité simple, P&L/jour, répartition setups/actifs en %, émotions, KPIs), le compagnon de session complet, ET l'IA **mutualisée** (contexte marché, calendrier éco IA, news filtrées) dont le coût est indépendant du nombre d'users. Voir ce qu'on a fait est gratuit — c'est le moteur d'activation.
- **PREMIUM = le *comment* et le *pourquoi*** : la profondeur d'analyse par-dessus les mêmes données (win rate par setup/actif, heatmaps jour/heure, drawdown détaillé, filtres croisés, multi-comptes, export) **ET** la couche IA **personnelle** (Weekly Debrief, IA Insights sur les patterns, Chat coach).

**Corollaire design** : on ne verrouille pas une **carte**, on verrouille la **couche de profondeur** dedans (vue de base visible en Free · analyse avancée / IA personnelle en Premium). Un teaser flouté + cadenas est réservé aux couches réellement payantes, jamais aux données de base ni à l'IA mutualisée (désormais FREE).

---

## Matrice feature × plan (grille de référence)

**Socle FREE** : compagnon de session complet (pré-session + live + débrief), journal (émotions, setups), import + historique illimité, **trades illimités**, `/analytics/summary` (win rate, P&L, streak), vues de base du dashboard (équité simple, P&L/jour, top actifs simple, répartition setups en %, émotions), **1 compte de trading**, et l'**IA mutualisée** :
- 📊 **Contexte marché** (DXY, taux US, indices)
- 📅 **Calendrier éco IA** (bull/bear par actifs)
- 📰 **Flux news filtrées** sur tes actifs (+ traduction Haiku cachée)

**PREMIUM** : tout le FREE, plus la **profondeur** et l'**IA personnelle** :
- 📋 **Weekly Debrief IA** (auto, 1/user/semaine)
- ✨ **IA Insights à la demande** (analyse de tes patterns)
- 💬 **Chat coach IA**¹
- 🏆 **Score trader /100** hebdomadaire
- 📈 **Analytics avancés** (heatmap heure, equity/drawdown détaillé, by-setup)
- 📄 **PDF du débrief de la semaine** (aucun rapport mensuel n'existe)
- 🌙 **Recap journalier email 17h30**
- **Comptes illimités**, chacun avec les règles de sa prop firm (le FREE a déjà son compte avec ses règles)
- 🚨 **Alertes avant la limite** et 🧘 **anti-tilt** en direct (+ sons et notifications) : app ouverte,
  compte Tradovate connecté (synchro en direct uniquement, rien sur une saisie manuelle, pas d'e-mail ;
  push vers les appareils abonnés, #666 ; app fermée, limites, objectif et payout relevés par la
  synchro de fond, jusqu'à 15 min de décalage ; veille serveur #770, éteinte tant que
  `TRADOVATE_WATCH_MAX` n'est pas posé : en direct aussi app fermée pendant la séance, Premium seulement)

### Avantages affichés : liste officielle (`PLAN_BENEFITS`, `@mtc/shared`, validée le 2026-10-19)

Source UNIQUE des listes courtes : fenêtre des offres (app), cartes de tarifs de `/` et `/prop-firm`,
e-mail de bienvenue Premium. Toute ligne = une fonction livrée ; toute ligne Premium = une fonction
réservée au Premium. Changer une ligne → `libs/shared/src/plan-benefits.ts` seulement.
- **Colonne de présentation de `/register` et `/login`** : `SIGNUP_PITCH_POINTS`
  (`libs/shared/src/signup-pitch.ts`), même règle ; une ligne marquée Premium porte le `benefitId` de
  sa ligne `PLAN_BENEFITS.premium` (vérifié par le spec) : aujourd'hui `anti_tilt` et
  `weekly_debrief`. Compagnon de séance, suivi de la marge et journal : sans étiquette (gratuits).
- **Gratuit** : Synchro Tradovate automatique, en lecture seule · 1 compte avec les règles de sa prop
  firm, suivi en direct pendant la séance (equity, marge avant le plancher, objectif ou payout) ·
  Journal et trades illimités, historique complet · Préparation et débrief de chaque séance ·
  Calendrier éco, news et contexte marché.
- **Premium** : Alertes avant d'atteindre ta limite de perte, app ouverte pendant ta séance (compte
  Tradovate connecté) · Anti-tilt en direct, app ouverte (compte Tradovate connecté) : reprise de
  position après une perte, taille qui grossit, surtrading · Comptes illimités, chacun avec les
  règles de sa prop firm · Débrief de ta semaine rédigé par le coach IA · Analyses avancées : par
  setup, par heure, drawdown détaillé · Coach IA : insights, chat et récap du jour à 17 h 30.
- **Fondateur** : les 6 lignes Premium + prix bloqué à vie + satisfait ou remboursé (`FOUNDER_REFUND_DAYS`).
- La landing masque « Comptes illimités » tant que `FEATURES.multiAccounts` est éteint ; sur la home,
  l'encart « comptes » des cartes le dit déjà, la liste ne le répète pas.
- Bloc détaillé « Ce que Premium ajoute au Gratuit » (home, `Pricing.astro`) : plus long, mais même
  règle (livré ET réservé au Premium). Jamais « sync crypto » (non livrée), jamais « rapport PDF
  mensuel », jamais le calendrier éco ni l'import CSV d'un broker connu (gratuits) présentés comme Premium.

¹ **Chat coach** : usage réel mesuré ≈ **0 %** (admin, 30 j). NE PAS en faire l'ancre Premium. L'ancre Premium réelle = Insights + Weekly Debrief + analytics avancés + comptes illimités.

> **Modèle émotion (PROMPT-163)** : l'émotion de base d'un trade vient de la **journée/session**
> (`TradeSession.moodStart`) ; `Trade.emotion` est un **override optionnel**. **Émotion effective = override
> du trade sinon humeur de la session sinon `null`**. Toute lecture passe par `effectiveEmotion` +
> `isRiskyEmotion`/`isHealthyEmotion` (`common/utils/effective-emotion.util.ts`). Détails → `prisma.md`.

> **Win rate + break-even (PROMPT-160)** : 3 résultats — win (`pnl > ε`), loss (`pnl < -ε`), **break-even**
> (`|pnl| <= ε`). **Win rate = wins / (wins + losses)** (BE hors dénominateur). Calcul centralisé dans
> `computeTradeStats` (`@mtc/shared`, source unique front + back).

> **Note d'exécution (PROMPT-161)** — **calculée, pas saisie** ; **déterministe, zéro token IA** ;
> **indépendante du P&L**. Grade : ≥80 EXCELLENT · 60-79 BON · 40-59 MOYEN · <40 MAUVAIS ; **< 2 critères
> applicables → `null`**. Helper `computeExecutionGrade` (`common/utils/execution-grade.util.ts`).
>
> **Deux barèmes selon la présence d'un stop (PROMPT-168)** — détection **au niveau du trade**.
> `Trade.executionMethod` (`STOP_BASED` | `BEHAVIORAL` | null) **trace lequel a servi** — les deux ne
> mesurent PAS la même chose, **non comparables**.
> - **Barème A — STOP_BASED** (`stopLoss` présent) : 4 critères intrinsèques — stop respecté (35) · R:R
>   ≥1.5 (25) · émotion effective saine (20) · risque ≤1% (20). **Inchangé.**
> - **Barème B — BEHAVIORAL** (`stopLoss` absent : scalp manuel, imports broker) : 3 critères **relatifs à
>   l'historique du compte** (médianes) — **perte contenue** (40, sur trade perdant : `L≤1.5×Lméd`→1,
>   `≤3×`→0.5, sinon 0) · **pas de revenge** (35, délai depuis le dernier perdant du **même jour** :
>   `<2 min`→0, `2-10`→0.5, `>10`→1) · **taille constante** (25, anti-martingale strict, si le trade
>   précédent est une perte : `Q≤Qméd`→1, `≤2×`→0.5, sinon 0). Même mécanique de score/renormalisation.
>   Aucun critère n'utilise le **signe du P&L comme mesure de réussite**.
> - **Garde-fous B** : **historique minimum 20 trades clôturés** (sinon `null`) ; **< 2 critères → `null`** ;
>   trades ouverts jamais notés.
> - **Contextuel ⇒ recalcul par lot** : `TradesService.recomputeBehavioralGrades(accountId)` recalcule **en
>   une passe** (pas de N+1) après import / édition / suppression / réaffectation. La note **évolue** avec
>   l'historique (attendu). Constantes ajustables dans `execution-grade.util.ts`. **Calibrage** : tout MAUVAIS
>   ou tout EXCELLENT sur données réelles → ajuster les constantes, **pas** la structure.

---

## Gating du dashboard — carte par carte
Vue de base = FREE ; profondeur & IA = PREMIUM.

| Carte | FREE (visible) | PREMIUM |
|---|---|---|
| KPIs (Capital, P&L, Win rate, Trades, Drawdown) | ✅ tout | – |
| Courbe d'équité | ✅ courbe simple | drawdown détaillé, périodes comparées |
| P&L par jour | ✅ | – |
| Top actifs (P&L/instrument) | ✅ vue simple | win rate/actif, filtres croisés |
| Répartition stratégies (par setup) | ✅ camembert % | **win rate & rentabilité par setup** |
| États émotionnels | ✅ (socle Free) | – |
| Contexte marché / news / calendrier éco IA | ✅ (IA mutualisée) | – |
| AI Coach / IA Insights / Weekly Debrief / Score | – | ✅ teaser flouté + cadenas |

Règles :
- Ne JAMAIS afficher `● LIVE` sur une carte verrouillée (le lock l'emporte).
- Le badge d'un item (sidebar/carte) doit refléter le plan RÉEL de la feature ET ce que le backend livre. Badges front = **PREMIUM** (plus de badge STARTER).

---

## Modèle de coût IA (règle de tiérage)
On tiér par **structure de coût**, PAS par « IA vs pas d'IA ».

- **MUTUALISÉ** — coût O(signatures d'actifs / clés partagées), indépendant du nb de users → **FREE** :
  - Contexte marché : 1 clé Redis partagée `market:context` (TTL).
  - Calendrier éco : cache BDD `ecoAnalysisCache` par `(date, assetsKey)`, `userId:'shared'`.
  - News : `marketNews` partagé (cron) ; traduction Haiku **1×/article**, `userId:null`, cachée.
- **BORNÉ** — 1/user/période, `max_tokens` capé → **PREMIUM** :
  - Weekly Debrief : 1/user/semaine. `max_tokens` = min(10 240, 2 500 + 1 125 × comptes)
    (`debriefMaxTokens`, relevé de 25 % le 2026-10-08 : à 2 comptes, Sonnet 4.6 montait à 85 % de 3 800).
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

---

## Règle d'or — cohérence aux 4 points
Toute feature gated doit être alignée **partout**, sinon on vend une chose qu'on ne livre pas :
1. **Landing** (`Pricing.astro` + JSON-LD `Base.astro` + CGU) — ce qui est promis.
2. **Front app** — affichage + accès (`isPremium`, badges PREMIUM, `premium-lock`).
3. **Guard backend** (`PremiumGuard`) sur le controller (le `StarterGuard` a été supprimé).
4. **Éligibilité asynchrone** (crons) — `debrief.getEligibleUsers(refDate)`, `daily-recap` (where plan).

> L'incohérence historique à ne jamais reproduire : « feature vendue sur la landing mais cron d'éligibilité restreint » → le client paie une IA jamais livrée.

---

## Gating — qui gouverne quoi
- **PremiumGuard** passe : ADMIN, BETA_TESTER, essai actif (`trialEndsAt`), PREMIUM.
- **Premium offert par l'admin** (2026-10-03) : `POST /admin/users/:id/offer-premium` écrit
  `trialEndsAt = max(now, trialEndsAt) + N j` (défaut 30, max 90) et `trialUsed = true` ; **le plan reste
  FREE**. Aucun abonnement Stripe, aucun prélèvement : l'accès retombe seul à la date de fin. C'est la
  **seule** source réelle de `trialEndsAt` aujourd'hui : l'essai Stripe, lui, ne l'écrit pas (il passe par
  `plan = PREMIUM` + `stripeSubscriptionStatus = trialing`). « Offert » = `trialEndsAt` futur **et** pas
  d'abonnement Stripe actif/trialing (`isOfferedPremium`, `users/premium-offer.util.ts`). Refusé (409) si
  abonnement Stripe en cours, plan PREMIUM, rôle ADMIN/BETA_TESTER ou compte démo. `trialUsed = true` →
  pas de second essai de 30 j au checkout. Stats admin : ces comptes sont comptés en `freeUsers`, **pas**
  en `trials` (qui exige `plan = PREMIUM`) ni dans le MRR.
- **IA mutualisée (contexte marché, news, calendrier éco bull/bear)** : **FREE** — aucun guard (juste `JwtAuthGuard`).
- **Analytics avancés** (`by-setup`, `by-hour`) : `PremiumGuard`.
- **Activité / calendrier** (`activity/:year/:month`, `activity/range`, `activity/current-month`) : **FREE**, aucun guard. Ce sont les données propres de l'utilisateur (le *quoi*) — on ne verrouille pas la vue de ses propres données. Le guard qui vivait sur `:year/:month` était en plus contournable via `activity/range`, qui sert la même donnée (PROMPT-185). Contrat verrouillé par `analytics.controller.spec.ts`.
- **Weekly Debrief** : controller `PremiumGuard` **ET** cron `getEligibleUsers()` doivent matcher → `plan === PREMIUM` ou `role ∈ {ADMIN, BETA_TESTER}` ou essai.
  Le débrief **automatique** (cron dimanche + rattrapage lundi + régénération admin « tous ») ne vise
  que ceux qui ont **tradé dans la semaine** (`getEligibleUsers(refDate)`, SCA-B5-08, décision du
  2026-10-07) : semaine vide = ni appel IA ni e-mail. La génération manuelle depuis l'app reste ouverte.
- **Notifications push des traders (#666)** : les plans ne changent pas, le push relaie seulement
  ce que le plan donne déjà. Types `PROP_RULES`, `BEHAVIOR`, `RECAP` = Premium (`PUSH_PREMIUM_TYPES`,
  `@mtc/shared`), `CONNECTION` (connexion Tradovate à renouveler) = **gratuit**, la synchro Tradovate
  l'étant. Gating CÔTÉ API dans `TraderNotifier` (`isPremiumAccess`), en plus des sources (déjà
  Premium). S'abonner est ouvert à tous (un Free reçoit `CONNECTION`).
- **Veille serveur (#770)** : WebSocket Tradovate gardé app fermée pendant la séance = **Premium**
  (`isPremiumAccess`, dans `watchVerdict`, côté API), comme les alertes en direct qu'elle relaie.
  Cohérence aux 4 points : guard = `watchVerdict` ; front = texte du délai selon `liveWhileClosed` ;
  cron = synchro de fond inchangée ; **landing (`Pricing.astro`, 2 lignes « app ouverte ») à changer
  SEULEMENT le jour où `TRADOVATE_WATCH_MAX` est posé en prod** (« app ouverte ou en notification
  pendant ta séance »), pas avant : elle décrirait une fonction éteinte.
- **Daily recap** : accès Premium réel (`isPremiumAccess` : PREMIUM, ADMIN, BETA_TESTER, essai / **mois offert**
  actif), même règle que le Weekly Debrief, au cron (`DailyRecapCron`) ET à la génération de la phrase IA
  (`DailyRecapService`). Avant #627, `plan: 'PREMIUM'` seul : un mois offert n'avait pas son récap.
- **Comptes** : controller **non gaté** (FREE accède à son 1 compte) — le plafond est appliqué dans `AccountsService` (FREE 1, Premium illimité).
- **Suivi prop firm de la session live** (#369) : **FREE**, aucun guard — mêmes données que « Mes comptes » (on ne verrouille pas la vue de ses propres données), sur le compte de la session.
- **Perte journalière + alertes « avant la casse »** (#370) : **PREMIUM**, gating CÔTÉ API aux deux points : `GET /accounts` ne calcule `metrics.dailyLoss` que si `isPremiumAccess` (sinon `null`), et `PropAlertsService.check` sort sans rien envoyer hors Premium / démo. Front : bloc « Perte du jour » si `dailyLoss` présent, teaser PREMIUM (modale des offres) pour un compte gratuit relié à un plan. Coût IA nul. Consistency (gain max du jour), objectif atteint et payout possible : aussi en alerte (#370, 2e partie), même gating. Anti-tilt en direct (#371 : revenge, taille après une perte, surtrading) : PREMIUM, même gating côté API (`TiltAlertsService`). Récap 17h30 et Weekly Debrief nourris par les séances suivies en direct (#373 / #374, `PropRiskContextService`) : PREMIUM comme ces deux IA (classe « BORNÉ », prompt plus riche, aucun appel en plus).
- **Synchro Tradovate par API** (PROMPT-207) : **FREE**, aucun guard — même règle que l'import CSV d'un broker connu (socle « import »), zéro coût IA. Décision Greg 2026-09-11. Le FREE reste borné à 1 compte, donc à 1 connexion. Aucune « sync crypto » n'existe (retirée de la grille et des listes le 2026-10-19) : si une synchro Binance/Bybit arrive, trancher explicitement son palier et l'ajouter à `PLAN_BENEFITS`.
- **Front** : `isPremium` = PREMIUM / trial / admin / beta (l'alias `isStarterOrAbove` a été supprimé).

## Essai 30 jours (mensuel uniquement)
- Accordé **si** `!user.trialUsed` **ET** prix **mensuel** (`isMonthlyPrice`). Constante `TRIAL_PERIOD_DAYS = 30`.
- **Annuel** : aucun essai, facturation immédiate (un essai suivi d'un prélèvement de 490€ génère contestations).
- **`trialUsed`** n'est marqué `true` **que** si un essai a réellement été accordé (`subscription.trial_end != null`) — un abonné annuel direct garde son droit à l'essai (fix PROMPT-169).
- Messaging : **« 1 mois offert · carte requise · annulable en un clic »** partout (landing, register, emails, CGU). Pas de « sans CB » sur le payant (l'essai passe par Stripe checkout = carte requise).

---

## Checklist avant TOUT changement de plan/feature
- [ ] Prix identiques dans **`libs/shared/src/pricing.ts`**, la landing, le JSON-LD et les CGU.
- [ ] Feature gated cohérente aux **4 points** (landing / front / guard / cron).
- [ ] Nouvelle feature IA classée **mutualisé (FREE) / borné (PREMIUM) / scale (PREMIUM)**.
- [ ] Quota comptes modifié → `accounts.service` **et** `ACCOUNT_LIMITS` (front) alignés.
- [ ] Copie AMF-compliant (aucune promesse de gain).
- [ ] Compte démo : nouvelle feature à données → vérifier l'affichage démo + enrichir le seed.

> **Valeurs tarifaires centralisées (2026-09-13)** : 49 € / 490 €, essai 30 j et quotas de comptes
> vivent dans `libs/shared/src/pricing.ts` (`@mtc/shared`). Les `pricing.const.ts` de l'API, de
> l'app et de l'admin en dérivent (mêmes noms d'export qu'avant). Changer un prix = ce fichier +
> la landing `Pricing.astro` + les `STRIPE_*_PRICE_*`.

## Offre fondateur (#525, 2026-10-07)

Constantes : `FOUNDER_OFFER = { priceMonthlyEur: 29, priceAnnualEur: 290, seats: 200 }`,
`FOUNDER_ANNUAL_SAVINGS_EUR` (dérivée), `FOUNDER_REFUND_DAYS = 14`, `FOUNDER_MILESTONES`, `OFFER_CTAS`
(`libs/shared/src/pricing.ts`). Prix Stripe : `STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER` / `_YEARLY_FOUNDER`.

- **200 places**, mensuel (29 €) ET annuel (290 €) confondus. **Prix bloqué à vie** tant que
  l'abonnement reste actif ; tout le Premium, nouveautés futures comprises.
- Mensuel ↔ annuel fondateur autorisé (`POST /billing/interval`) : même place, même numéro.
- **Aucun essai** (premier paiement immédiat) ; l'essai 30 j du 49 € est inchangé.
- **Satisfait ou remboursé 14 jours** sur le 1er paiement (engagement affiché). Côté code, **tout
  remboursement INTÉGRAL du 1er paiement, quel que soit le délai** (c'est Greg qui décide) → place
  `REFUNDED` (rendue), tarif perdu, abonnement annulé. Partiel ou renouvellement remboursé : rien.
  La charge est rapprochée de la 1re facture payée (> 0 €) par facture ou PaymentIntent.
- **Bascule** : un essai Stripe à 49 € ou un mois offert peut passer fondateur (prélèvement immédiat,
  l'essai est annulé au 1er paiement fondateur ; jamais de prolongation ni de cumul).
- **Lancement contrôlé** : `FounderOfferConfig.open` (fermé par défaut), `endsAt` optionnel. Fermé =
  personne d'éligible, `open: false` sur `GET /pricing/founder`, rien d'affiché.
- **Places** : prise au 1er paiement réussi (numéro 1 à 200, jamais réattribué). Rendue seulement si
  remboursement intégral du 1er paiement, 1er paiement en échec définitif, ou session Checkout expirée. Une résiliation
  ne la rend PAS. Exclus : démo, ADMIN, BETA_TESTER (une AMBASSADRICE est éligible).
- **Perte du tarif** : résiliation programmée = gardé jusqu'à la fin (réactivation = gardé) ;
  `past_due` = rien perdu (e-mail « ton tarif est en jeu ») ; perdu à `customer.subscription.deleted`
  (place `LOST`, reste comptée) ou au remboursement. Retour = prix normal.
- **Non-cumul** : fondateur, code partenaire et coupon de parrainage s'excluent ; le fondateur ne
  reçoit jamais le −10 % filleul (toujours moins cher sur la 1re année). Le mois offert au PARRAIN
  reste accordé (pas une remise pour l'acheteur). Commission ambassadeur : 20 % du montant payé.
- **Gating** : un fondateur est PREMIUM comme tout abonné Stripe actif (aucun guard à part).
- **Compteur de places** : TOUJOURS `founderSeatsLabel(seatsLeft, seatsTotal)` de `@mtc/shared`
  (modale de plans, page de paiement, carte et bandeau long de la landing, e-mail de lancement).
  Aucune place prise → « 200 places disponibles » (jamais « Plus que 200 places sur 200 » : fausse
  urgence, remontée par Greg le 17/10) ; ensuite « Plus que 154 places sur 200 », « Plus qu'une place
  sur 200 » ; 0 → `null`, l'offre complète n'affiche pas de compteur. Total = `seatsTotal` de l'API,
  sinon `FOUNDER_OFFER.seats`. Seul le bandeau COURT mobile affiche le nombre nu (« 154 places »).
  Garde : `libs/shared/src/founder-seats-usage.spec.ts`.
- **E-mails de la suite d'onboarding** (`first_week_recap`, `founder_followup`) : prix, essai, places
  et délai de remboursement lus dans `@mtc/shared` (`FOUNDER_OFFER`, `PREMIUM_PRICE_EUR`,
  `TRIAL_PERIOD_DAYS`, `FOUNDER_REFUND_DAYS`, `founderSeatsLabel`). Changer une valeur → les e-mails
  suivent. `founder_followup` ne part que si l'offre est ouverte avec des places, vérifié à l'envoi.
- **Messages de refus** (`closed`, `sold_out`, `excluded`, `already_founder`, `tariff_lost`,
  `subscribed`) : `FOUNDER_INELIGIBLE_MESSAGES` de `@mtc/shared`, source UNIQUE du 400 du checkout
  ET de la modale de plans quand un lien `plan=founder` tombe sur une offre inaccessible (#578).
  Modifier un texte → ici seulement.

## Codes partenaires (#525, 2026-10-07)

`modules/partner-codes/` (`PartnerCodeService`, fonctions pures dans `partner-code.util.ts`).

- Un formateur donne un code (ex. fictif `TRADER10`) : Premium à un prix réduit **réglable code par code**
  (mensuel et annuel entre 1 € et le prix normal − 1, entiers). Ces abonnés ne sont **pas** fondateurs
  et ne prennent **aucune** place.
- **Exemples toujours fictifs** (placeholders, aide, e-mails, tests) : jamais le code ou le nom d'un
  vrai partenaire, qui n'apparaît que là où il sert réellement (base, admin). Exemple maison :
  `TRADER10` (vérifié absent des codes partenaires et de parrainage le 17/10).
- Réglages : durée **à vie** (`durationMonths` null) ou **N mois** puis prix normal ; personnes
  **illimité** ou **N** (`maxRedemptions`) ; date de fin d'**utilisation** (`expiresAt`, n'arrête pas la
  remise des abonnés) ; `active`.
- **Prix pile** : coupon Stripe `amount_off` EUR = prix normal − prix remisé, **de l'intervalle choisi**
  (−20 € → 29,00 €, −200 € → 290,00 €), appliqué côté serveur sur le prix NORMAL. Coupons créés par
  l'API, identifiant déterministe `mtc-partner-<centimes>-<forever|N>`. Sur l'annuel, un coupon N mois
  remise chaque facture émise pendant N mois (la 1re année seulement si N ≤ 12).
- **Essai 30 j conservé** (mensuel, règles actuelles) : c'est le prix normal remisé.
- Une utilisation par personne, seulement si **jamais abonnée** (aucun abonnement Stripe passé ou en
  cours, jamais fondateur ; un mois offert hors Stripe ne compte pas). Démo et ADMIN exclus.
- Modifier un code ne change rien pour les abonnés existants : conditions **figées** dans
  `PartnerRedemption` ; prix ou durée modifiés → nouveaux coupons pour les futurs abonnés.
- Jamais sur un prix fondateur (choix explicite, 400 si les deux). Avec un parrainage : le plus
  avantageux sur la 1re année (`partnerFirstYearCost` vs `referralFirstYearCost`) ; si le −10 % gagne,
  le code n'est pas consommé.
- Utilisation comptée à la 1re facture (`subscription_create`, 0 € d'essai compris). Rendue au quota si
  remboursement intégral du 1er paiement réel (quel que soit le délai) ou fin d'essai impayée (`cancellation_details.reason =
  payment_failed` sans paiement). Abonnement terminé → remise perdue (`LOST`, reste comptée).
- Changement d'intervalle (`POST /billing/interval`) : coupon de l'autre intervalle aux conditions
  figées, pour les mois de remise restants.
- **MRR** (base et Stripe) sur le montant **réellement payé** : découpé `mrrBreakdown`
  normal / fondateur / partenaires (`realMonthlyEur`). Le MRR Stripe déduit les remises
  (`expand: data.discounts`). Reste : le −10 % filleul n'est pas déduit du MRR base (écart connu).
- Commission ambassadeur : 20 % de `invoice.amount_paid`, donc déjà sur le montant remisé.
- **Satisfait ou remboursé (choix #525)** : demande par e-mail à support@ depuis Profil > Abonnement et depuis l'écran de suppression
  (lien jusqu'à J+14 du 1er paiement), remboursement fait à la main dans Stripe ; le webhook
  `charge.refunded` rend la place et annule l'abonnement. Aucune route ne déplace d'argent toute seule.
- **Suppression du compte MTC** : l'abonnement Stripe est résilié **immédiatement** (sans prorata
  ni remboursement), avant la suppression ; Stripe en échec → rien supprimé. Le webhook
  `customer.subscription.deleted` qui suit marque le tarif fondateur / partenaire perdu. L'écran de
  suppression le dit (« Ton abonnement est résilié immédiatement. ») et rappelle le lien de
  remboursement fondateur tant que `refundUntil` court. Un remboursement fait APRÈS la suppression
  ne trouve plus l'utilisateur (`charge.refunded` sans effet sur la place) : à gérer à la main.
- **Points d'affichage (cohérence)** : landing (bandeau, carte, FAQ), app (modale, cadenas, Profil,
  « Continuer en Premium »), API (checkout, webhooks), e-mails (phase F).

