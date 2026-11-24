# Gating : qui gouverne quoi

> Contenu déplacé à l'identique depuis `.claude/agents/plans.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : plans.md · Gating — qui gouverne quoi · 2026-07-04 -->
> **Origine** : `plans.md` · « Gating — qui gouverne quoi » · 2026-07-04

## Gating — qui gouverne quoi
- **PremiumGuard** passe : ADMIN, BETA_TESTER, essai actif (`trialEndsAt`), PREMIUM.
- **Premium offert par l'admin** (2026-10-03) : `POST /admin/users/:id/offer-premium` écrit
  `trialEndsAt = max(now, trialEndsAt) + N j` (défaut 30, max 90) et `trialUsed = true` ; **le plan reste
  FREE**. Aucun abonnement Stripe, aucun prélèvement : l'accès retombe seul à la date de fin. C'est la
  source de `trialEndsAt` avec l'essai d'inscription (#769, `trialSource` distingue `ADMIN` / `SIGNUP` ;
  offert pendant l'essai = durées additionnées). L'essai Stripe, lui, ne l'écrit pas (il passe par
  `plan = PREMIUM` + `stripeSubscriptionStatus = trialing`). « Offert » = `trialEndsAt` futur **et** pas
  d'abonnement Stripe actif/trialing (`isOfferedPremium`, `users/premium-offer.util.ts`). Refusé (409) si
  abonnement Stripe en cours, plan PREMIUM, rôle ADMIN/BETA_TESTER ou compte démo. `trialUsed = true` →
  pas de second essai de 30 j au checkout. **Retrait** (B10 #1064, décision du 16/11) :
  `DELETE /admin/users/:id/offer-premium` (bouton « Retirer le Premium offert » de la fiche), seulement
  `trialSource` ADMIN ou absent (offert d'avant #769) avec `trialEndsAt` futur et sans abonnement Stripe (même en pause) : `trialEndsAt`
  = maintenant, ou la fin de l'essai d'inscription s'il court encore (`trialSource` repasse SIGNUP).
  La modale « Modifier » ne change plus le plan ni le rôle (A1/B2 #1064). Stats admin : ces comptes sont comptés en `freeUsers`, **pas**
  en `trials` (qui exige `plan = PREMIUM`) ni dans le MRR.
- **IA mutualisée (contexte marché, news, calendrier éco bull/bear)** : **FREE** — aucun guard (juste `JwtAuthGuard`).
- **Analytics avancés** (`by-setup`, `by-hour`) : `PremiumGuard`.
- **Activité / calendrier** (`activity/:year/:month`, `activity/range`, `activity/current-month`) : **FREE**, aucun guard. Ce sont les données propres de l'utilisateur (le *quoi*) — on ne verrouille pas la vue de ses propres données. Le guard qui vivait sur `:year/:month` était en plus contournable via `activity/range`, qui sert la même donnée (PROMPT-185). Contrat verrouillé par `analytics.controller.spec.ts`.
- **Weekly Debrief** : controller `PremiumGuard` **ET** cron `getEligibleUsers()` doivent matcher → `plan === PREMIUM` ou `role ∈ {ADMIN, BETA_TESTER}` ou essai.
  Le débrief **automatique** (cron dimanche + rattrapage lundi + régénération admin « tous ») ne vise
  que ceux qui ont **tradé dans la semaine** (`getEligibleUsers(refDate)`, SCA-B5-08, décision du
  2026-10-07) : semaine vide = ni appel IA ni e-mail. Trade = trade **clôturé** (#1056) : une semaine
  de positions ouvertes compte comme vide. La génération manuelle depuis l'app reste ouverte.
- **Notifications push des traders (#666)** : les plans ne changent pas, le push relaie seulement
  ce que le plan donne déjà. Types `PROP_RULES`, `BEHAVIOR`, `RECAP` = Premium (`PUSH_PREMIUM_TYPES`,
  `@mtc/shared`), `CONNECTION` (connexion Tradovate à renouveler) = **gratuit**, la synchro Tradovate
  l'étant. Gating CÔTÉ API dans `TraderNotifier` (`isPremiumAccess`), en plus des sources (déjà
  Premium). S'abonner est ouvert à tous (un Free reçoit `CONNECTION`).
- **Veille serveur (#770)** : WebSocket Tradovate gardé app fermée pendant la séance = **Premium**
  (`isPremiumAccess`, dans `watchVerdict`, côté API), comme les alertes en direct qu'elle relaie.
  Cohérence aux 4 points : guard = `watchVerdict` ; front = texte du délai selon `liveWhileClosed` ;
  cron = synchro de fond inchangée ; landing + `PLAN_BENEFITS` + `SIGNUP_PITCH_POINTS` : « app ouverte
  ou en notification pendant ta séance » (`plan-benefits.spec.ts` le vérifie). Ce texte n'est vrai
  qu'avec `TRADOVATE_WATCH_MAX` posé en prod : **la variable est posée sur le VPS prod AVANT la
  promotion qui apporte ce texte** (inerte sur l'ancien code). Retirer la veille en prod = remettre
  « app ouverte » partout.
- **Daily recap** : accès Premium réel (`isPremiumAccess` : PREMIUM, ADMIN, BETA_TESTER, essai / **mois offert**
  actif), même règle que le Weekly Debrief, au cron (`DailyRecapCron`) ET à la génération de la phrase IA
  (`DailyRecapService`). Avant #627, `plan: 'PREMIUM'` seul : un mois offert n'avait pas son récap.
- **Comptes** : controller **non gaté** (FREE accède à son 1 compte) — le plafond est appliqué dans `AccountsService` (FREE 1, Premium illimité).
- **Suivi prop firm de la session live** (#369) : **FREE**, aucun guard — mêmes données que « Mes comptes » (on ne verrouille pas la vue de ses propres données), sur le compte de la session.
- **Vue multi-comptes** (#668, décision du 22/11) : **FREE**, aucun guard, aucun nouveau calcul. Tri par exposition, « Le plus exposé » et bandeau « Mes comptes » de la Session live ouverts à tous les plans (`MULTI_ACCOUNT_VIEW_FOR_ALL_PLANS`). Cas réel côté gratuit : un compte revenu au gratuit après l'essai qui garde plusieurs comptes actifs. La perte max du jour reste **PREMIUM** (calculée par l'API seulement en Premium, #370 ; teaser dans Mes comptes pour un compte gratuit actif relié à un plan qui prévoit une perte max du jour : `metrics.planHasDailyLoss`, calculé pour tous les plans, existence de la règle et non le calcul ; sinon « — »). Le quota de comptes ne change pas (FREE 1, Premium illimité) : « multi-comptes » Premium désigne le quota, pas la vue.
- **Perte journalière + alertes « avant la casse »** (#370) : **PREMIUM**, gating CÔTÉ API aux deux points : `GET /accounts` ne calcule `metrics.dailyLoss` que si `isPremiumAccess` (sinon `null`), et `PropAlertsService.check` sort sans rien envoyer hors Premium / démo. Front : bloc « Perte du jour » si `dailyLoss` présent, teaser PREMIUM (modale des offres) pour un compte gratuit relié à un plan (Session live : « Perte max du jour + alertes » si `metrics.planHasDailyLoss`, sinon « Alertes avant le plancher ») ; dans Mes comptes, seulement si le plan prévoit une perte max du jour (`metrics.planHasDailyLoss`, #668). Coût IA nul. Consistency (gain max du jour), objectif atteint et payout possible : aussi en alerte (#370, 2e partie), même gating. Anti-tilt en direct (#371 : revenge, taille après une perte, surtrading) : PREMIUM, même gating côté API (`TiltAlertsService`). Récap 17h30 et Weekly Debrief nourris par les séances suivies en direct (#373 / #374, `PropRiskContextService`) : PREMIUM comme ces deux IA (classe « BORNÉ », prompt plus riche, aucun appel en plus).
- **Bouclier annonces** (#670, décision du 2026-11-23) : **première alerte en direct GRATUITE**, à ne pas
  « corriger » en Premium. Toast `news:alert` sans guard ni contrôle de plan (`NewsShieldService`,
  `BehaviorAlertsService`) ; push filtré par `PUSH_PREMIUM_TYPES` (`BEHAVIOR`, `TraderNotifier`) ; app
  fermée seulement par la veille #770, déjà Premium ; stat `stats.newsWindow` lue seulement par
  `DebriefController` (`PremiumGuard`), bloc dans la branche Premium du débrief.
- **Synchro Tradovate par API** (PROMPT-207) : **FREE**, aucun guard — même règle que l'import CSV d'un broker connu (socle « import »), zéro coût IA. Décision Greg 2026-09-11. Le FREE reste borné à 1 compte, donc à 1 connexion. Aucune « sync crypto » n'existe (retirée de la grille et des listes le 2026-10-19) : si une synchro Binance/Bybit arrive, trancher explicitement son palier et l'ajouter à `PLAN_BENEFITS`.
- **Front** : `isPremium` = PREMIUM / trial / admin / beta (l'alias `isStarterOrAbove` a été supprimé).
