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
- 📄 **Export PDF** rapport mensuel
- 🌙 **Recap journalier email 17h30**
- **Comptes illimités** + règles prop firm par compte · sync crypto

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
  - Weekly Debrief : 1/user/semaine.
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
  Futures), on **retombe sur l'ancien chemin ligne par ligne** — `AI_BATCH` = 120 lignes, borne
  de sortie et non de coût (~40 jetons de JSON par trade contre `max_tokens: 8192`).
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

**Modèle par appel** — `AI_MODELS.fast` (Haiku) pour les tâches courtes et fréquentes : traductions news,
contexte marché, **et les deux appels du calendrier éco** (`ECO_MODEL` dans `ai.service.ts`, depuis le
2026-09-28). Le calendrier éco est la **seule IA qu'un compte FREE peut déclencher**, donc la seule dont
le coût suit l'audience : il n'a rien à faire sur `analysis`. Son coût ne suit pas le nombre d'users mais
le nombre de **signatures d'actifs distinctes** (cache partagé par `(date, assetsKey)`, top 5 actifs du
trader) — ≈ 0,002 $ l'appel. `analysis` (Sonnet) reste pour le chat, le recap quotidien, le débrief, les
insights et l'import CSV inconnu, tous PREMIUM.

**Coût IA réel constaté** (admin, 30 j) : ≈ **4,60 USD total**. Le coût IA n'est PAS un sujet ; ne pas sur-optimiser. Autoritatif = Anthropic Cost Report API.

---

## Règle d'or — cohérence aux 4 points
Toute feature gated doit être alignée **partout**, sinon on vend une chose qu'on ne livre pas :
1. **Landing** (`Pricing.astro` + JSON-LD `Base.astro` + CGU) — ce qui est promis.
2. **Front app** — affichage + accès (`isPremium`, badges PREMIUM, `premium-lock`).
3. **Guard backend** (`PremiumGuard`) sur le controller (le `StarterGuard` a été supprimé).
4. **Éligibilité asynchrone** (crons) — `debrief.getEligibleUsers()`, `daily-recap` (where plan).

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
- **Daily recap** : PREMIUM only.
- **Comptes** : controller **non gaté** (FREE accède à son 1 compte) — le plafond est appliqué dans `AccountsService` (FREE 1, Premium illimité).
- **Suivi prop firm de la session live** (#369) : **FREE**, aucun guard — mêmes données que « Mes comptes » (on ne verrouille pas la vue de ses propres données), sur le compte de la session.
- **Perte journalière + alertes « avant la casse »** (#370) : **PREMIUM**, gating CÔTÉ API aux deux points : `GET /accounts` ne calcule `metrics.dailyLoss` que si `isPremiumAccess` (sinon `null`), et `PropAlertsService.check` sort sans rien envoyer hors Premium / démo. Front : bloc « Perte du jour » si `dailyLoss` présent, teaser PREMIUM (modale des offres) pour un compte gratuit relié à un plan. Coût IA nul. Reste à livrer : #370 consistency / payout en alerte, #371 anti-tilt, #374 IA.
- **Synchro Tradovate par API** (PROMPT-207) : **FREE**, aucun guard — même règle que l'import CSV d'un broker connu (socle « import »), zéro coût IA. Décision Greg 2026-09-11. Le FREE reste borné à 1 compte, donc à 1 connexion. Ne pas la confondre avec « sync crypto » (ligne PREMIUM ci-dessus, non livrée) : si une synchro Binance/Bybit arrive, trancher explicitement son palier et mettre à jour cette ligne.
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
