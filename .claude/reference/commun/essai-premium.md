# Essai Premium : 14 jours à l'inscription (#769) et essai Stripe 30 jours

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/astro.md`, `.claude/agents/plans.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Essai Premium d'inscription (#769, 2026-10-26) · 2026-10-26 -->
> **Origine** : `angular.md` · « Essai Premium d'inscription (#769, 2026-10-26) » · 2026-10-26

## Essai Premium d'inscription (#769, 2026-10-26)

- **Encart « tu aurais été alerté » (B4)** : `mtc-live-prop-firm` (session live), entrée `sessionId`
  passée par `session-live` ; `missedAlert()` / `missedAlertPct()` (`live-prop-firm.util.ts`) sur les
  seuils partagés `alertLevel` de `@mtc/shared`. État par séance en localStorage
  `mtc_missed_alert:<sessionId>` `{ reached, closed }` (rangs 1 = 25 %, 2 = 10 %) : l'encart revient
  seulement pour un seuil plus profond que le dernier fermé. Gratuit, plan relié, hors démo.

- **`UserStore`** : `signupTrialDaysLeft()` (jours restants arrondis au supérieur, 1 le dernier jour ;
  `null` hors essai d'inscription, démo, abonné Stripe, Premium offert par l'admin),
  `signupTrialEnded()` (essai d'inscription fini, `trialSource` encore `SIGNUP`, aucun autre accès
  Premium, hors démo). `isOfferedPremium()` exclut `trialSource = SIGNUP` (même règle que l'API).
  `AuthUser` porte `trialSource` et `signupTrialEndsAt`.
- **Bandeau** « Premium offert · il te reste N jours » + « Voir les offres → » (`OfferIntentService.open('bandeau')`) :
  dans `mtc-topbar`, sous l'en-tête, NON collant (les vues calées sur le viewport n'ont pas de topbar
  et `--demo-banner-h` n'est pas touché). Spec : `topbar-trial-strip.spec.ts`. Masqué pendant une
  pause (`past_due` / `unpaid`) : son bouton mènerait au 409 `PAYMENT_PENDING` (B13 #1013). Le Profil
  dit « dernier jour » le jour de la fin, comme le bandeau (B11). Bouton du portail Stripe seulement
  avec un abonnement payant ou en essai (`hasBillingPortal`, B10).
- **Fenêtre des offres** pendant l'essai : plus de « 1 mois offert » (`trialUsed` posé à l'inscription)
  et une ligne `plan-trial-note` : fin du Premium offert (JJ/MM) et paiement dès la souscription.
- **Fin d'essai** : `mtc-trial-ended-modal` (shell, `@defer (when userStore.signupTrialEnded())`), une
  seule fois par compte et par appareil (localStorage `mtc_trial_ended_seen`, liste d'ids ; pas de
  colonne, décision du 26/10). Contenu = `PLAN_BENEFITS` (gratuit / Premium) ; renvoi vers Mes comptes
  si des comptes sont en trop. Téléphone : boutons collés en bas de la fenêtre.
- **Compte gardé** : `mtc-kept-account-panel` en haut de Mes comptes, visible seulement si un compte a
  `overFreeLimit` (API). Choix radio parmi les comptes ACTIVE, `POST /accounts/:id/keep`, puis
  `SelectedAccountStore.load()`. Libellé « gardé » (pas « actif », déjà le statut du compte).
- **Lien `/register?plan=premium`** (URL conservée, diffusée par la landing) : plus de paiement direct.
  `PostSignupService.afterSignup()` n'a plus d'option `premium` : tableau de bord, et l'intention
  `plan=premium` est effacée (aucune modale d'offres à l'arrivée). Textes de l'inscription : titre
  « Essaie Premium 14 jours » pour ce lien, ligne « 14 jours de Premium offerts · sans carte · puis
  gratuit, sans engagement » pour tous (`PREMIUM_SIGNUP_TRIAL_DAYS`). Garde :
  `features/auth/register-premium-link.spec.ts`. Formulaire d'inscription inchangé.
- Bundle initial : 478,74 ko (−0,43 ko, le paiement ne fait plus partie du retour d'inscription).

<!-- Origine : astro.md · Essai Premium d'inscription (#769, 2026-10-26) · 2026-10-26 -->
> **Origine** : `astro.md` · « Essai Premium d'inscription (#769, 2026-10-26) » · 2026-10-26

## Essai Premium d'inscription (#769, 2026-10-26)

Tout nouvel inscrit a `PREMIUM_SIGNUP_TRIAL_DAYS` (14, `@mtc/shared`) jours de Premium, sans carte,
puis repasse en Gratuit. La landing ne parle plus de l'essai Stripe de 30 jours ni de « 1 mois offert »
(sauf le mois offert au PARRAIN, `Referral.astro`, inchangé). Boutons « Essayer Premium · {jours}
jours offerts » + « Sans carte · puis Gratuit, sans engagement » (tarifs, `/prop-firm`), URL
`/register?plan=premium` CONSERVÉE (déjà diffusée ; l'app n'envoie plus au paiement). Durée toujours
par la constante, jamais écrite. Garde : `libs/shared/src/signup-trial-copy.spec.ts`.

<!-- Origine : plans.md · Essai d'inscription : 14 jours de Premium offerts (#769, 2026-10-26) · 2026-10-26 -->
> **Origine** : `plans.md` · « Essai d'inscription : 14 jours de Premium offerts (#769, 2026-10-26) » · 2026-10-26

## Essai d'inscription : 14 jours de Premium offerts (#769, 2026-10-26)
- Tout nouvel inscrit (e-mail ou Google, hors démo) : `trialEndsAt = signupTrialEndsAt = J+14`,
  `trialSource = SIGNUP`, `trialUsed = true`, plan **FREE** inchangé. Aucune carte, aucun Stripe.
- Réinscription avec l'e-mail d'un compte supprimé depuis moins de 90 j : pas d'essai.
- L'accès passe par les contrôles existants (`trialEndsAt`) : aucun chemin Premium parallèle.
- **Fin** : rien n'est supprimé. Le cron quotidien `TrialEndService` réaligne le rôle Discord (vaut
  aussi pour le Premium offert par l'admin). Comptes de trading en trop : visibles, signalés
  (`overFreeLimit`), l'utilisateur choisit le compte gardé. Arrêt de leur synchro (B0) : **journal
  seul** au 28/10 (comptés, rien bloqué), activation après lecture du décompte.
- **Affichage admin de l'essai** : plan FREE + `trialEndsAt` futur = essai en cours (`activeTrial`,
  `admin core/utils/trial.util.ts`). Fiche : « Premium (essai) », « Essai jusqu'au JJ/MM/AAAA » et la
  source (inscription = `trialSource` SIGNUP, sinon admin) ; ligne IA sur `identity.premiumAccess`
  (`isPremiumAccess`), jamais sur le plan brut. Liste : badge « Essai » (inscription) distinct de
  « Offert » (admin). `isOfferedPremium` et le bouton « Offrir » ne changent pas. `activeTrial` lit
  `subscriptionState` : une pause (`past_due` / `unpaid`) pendant l'essai s'affiche « En pause » partout
  (liste, fiche « En pause · paiement en attente », profil « Paiement en attente » avec la date de fin de
  l'accès offert), jamais « Essai » ; l'accès Premium, lui, continue jusqu'à `trialEndsAt`. Annulation
  programmée (`stripeCancelAt`, dans `ADMIN_USER_SELECT`) : badge « Essai annulé » ou « Résilié » dans la
  liste, comme la fiche. Équivalence ancienne règle / `premiumAccess` : `subscription-state.equivalence.spec.ts`.
- **Audit fonctionnel lot 2d (#1013, 2026-11-15)** :
  - Rappel J-7 (`ResendCron`) seulement avant une fin réelle (`stripeCancelAt` à J+7), objet « Ton
    Premium se termine le {date} » ; jamais à un abonné qui se renouvelle (A2).
  - E-mail d'échec de paiement : « accès Premium en pause », aucun délai promis (A3) ; `past_due` = gratuit.
  - `trial_ending` (J+11) hors plafond de fréquence (`bypassCap`, A11). BETA_TESTER exclus des e-mails
    d'essai, d'upsell (`first_week_recap`, `premium_upsell`) et fondateur ; ADMIN l'est partout (E6).
  - Lien d'offre, fondateur fermé ou inaccessible : seul `plan=founder` est oublié, un `promo` reste
    proposé (`keepPromoOnly`, B3).
  - En pause (`past_due` / `unpaid`) : la modale de plans ne montre que « Confirmer mon paiement »
    (portail) ; le cadenas l'ouvre aussi (B4).
  - Fenêtre « Premium offert terminé » jamais pour un ancien abonné payant (`subscriptionCanceledAt`
    exposé par `/auth/me`, B5).
  - Page de paiement : montant réel du filleul (44,10 € × 12 puis 49 €, 441 € puis 490 €) jusque dans la
    mention de prélèvement (`REFERRAL_DISCOUNT`, B8) ; avantages = `PLAN_BENEFITS.premium` (B9).
  - Camembert des setups du FREE sur la période (`GET /analytics/setup-shares`, nombres seulement, E1).
  - Paywalls : un seul libellé (`PaywallCtaService`, E3) ; essai Stripe = « 30 jours d'essai · carte
    requise » (`TRIAL_LABEL`, Q1), jamais « 1 mois offert » (réservé au mois offert du parrain et au lot du tirage mensuel des gratuits, `commun/tirage-mensuel.md`). Essai
    gardé pour les comptes antérieurs jamais essayés (`trialUsed` faux), ligne dans les CGU.
- **État d'abonnement unique (#813, 2026-11-01)** : `subscriptionState` (`libs/shared/src/subscription-state.ts`,
  fonction pure partagée API / app / admin). Ordre : statut Stripe (`active` = payant, `trialing` = essai
  d'abonnement, `past_due` / `unpaid` = en pause), puis `trialEndsAt` futur (SIGNUP = essai d'inscription,
  sinon offert), rôle ADMIN / BETA_TESTER, plan PREMIUM sans abonnement (accès manuel), gratuit.
  `premiumAccess` = règle des guards inchangée ; `isPremiumAccess` et `UserStore.isPremium` l'appellent.
  **`trialEndsAt` n'est jamais écrit par Stripe** : il ne dit rien d'un abonnement. Date du 1er
  prélèvement d'un essai d'abonnement = `stripeCurrentPeriodEnd` ; fin programmée = `stripeCancelAt`.
  Un abonné qui paie pendant son essai d'inscription (réservation à moins de 48 h, essai terminé en
  avance) est « payant ». Place fondateur d'un essai annulé : rendue **à la fin de l'essai**
  (`customer.subscription.deleted`, décision G2), e-mail de réservation aligné. Checkout refusé (409,
  `PAYMENT_PENDING_MESSAGE`) en `past_due` / `unpaid` : confirmer le paiement, jamais une nouvelle offre.
- **KPI admin selon l'état (#828, décisions G3 / G4)** : « Premium » = **accès** Premium (payants, essais,
  offerts, bêta, accès manuels) ; « Essais » = essai d'inscription + essai d'abonnement ; « Offerts » à
  part ; « En pause » (`past_due` / `unpaid`) ; « Gratuits » = état `free` seulement. MRR inchangé
  (abonnements `active`). Comptage par `subscriptionStateWhere` (`common/stats/`), testé contre la
  fonction sur un compte par état (`subscription-state-where.int-spec.ts`). Page Abonnements :
  « payants » = `active` seulement, liste « Essais et offerts ». Historique `MetricsSnapshot` du 28/10 au
  31/10 (dernier relevé pris avec l'ancien code, #828 en prod le 01/11) : **annoté, jamais recalculé**
  (`TRIAL_KPI_UNRELIABLE`, `@mtc/shared`, mention « essais non comptés » sur la courbe du dashboard).
- **Encart de séance du gratuit (B4)** : compte gratuit relié à un plan prop firm, en séance : quand la
  marge avant le plancher franchit un seuil d'alerte Premium, « Avec Premium, tu aurais été alerté à
  25 % (puis 10 %) de ta marge avant le plancher ». MÊMES seuils que les alertes Premium (25 % puis
  10 %, `@mtc/shared` `alert-levels.ts`) : le 50 % de la jauge n'est qu'une couleur, aucune alerte
  Premium n'y part. Une fois par seuil et par séance, fermable, jamais bloquant, aucune alerte envoyée ;
  jamais pour un Premium ni la démo.
- **Après l'essai** : mensuel 49 € sans essai Stripe (`trialUsed`), annuel inchangé. Garde : `stripe/stripe-signup-trial.spec.ts`.
- **Relances Premium** (`first_week_recap`, `founder_followup`, `premium_upsell`) : jamais pendant un essai en cours. Les anciens
  comptes jamais essayés gardent les 30 j.
- **Coût IA** estimé (prod, coûts moyens par appel) : ≈ 0,10 à 0,20 $ par inscrit sur 14 j,
  ≈ 0,40 $ au pire ; 300 inscrits ≈ 30 à 60 $ (pire cas ≈ 120 $).

<!-- Origine : plans.md · Essai Stripe 30 jours (mensuel, comptes antérieurs à #769 seulement) · 2026-10-27 -->
> **Origine** : `plans.md` · « Essai Stripe 30 jours (mensuel, comptes antérieurs à #769 seulement) » · 2026-10-27

## Essai Stripe 30 jours (mensuel, comptes antérieurs à #769 seulement)
- Accordé **si** `!user.trialUsed` **ET** prix **mensuel** (`isMonthlyPrice`). Constante `TRIAL_PERIOD_DAYS = 30`.
- **Annuel** : aucun essai, facturation immédiate (un essai suivi d'un prélèvement de 490€ génère contestations).
- **`trialUsed`** n'est marqué `true` **que** si un essai a réellement été accordé (`subscription.trial_end != null`) — un abonné annuel direct garde son droit à l'essai (fix PROMPT-169).
- Messaging (#769, remplace « 1 mois offert · carte requise ») : **« {PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts · sans carte · puis gratuit, sans engagement »** (inscription, landing, FAQ, CGU, e-mail de bienvenue). Boutons « Essayer Premium · {N} jours offerts » (URL `/register?plan=premium` conservée, plus de paiement direct). Relances e-mail (`first_week_recap`, `premium_upsell`) : « Sans engagement, annulable en un clic », aucun essai promis. Fenêtre des offres pendant l'essai : « Si tu t'abonnes maintenant, tu paies dès aujourd'hui et les jours offerts restants ne sont pas reportés » (vérifié : la synchro Stripe ne touche pas `trialEndsAt`). « 1 mois offert » ne reste que pour le PARRAIN.
- `first_week_recap` (J7-J14, essais en cours exclus) ne touchait plus que les inscrits SANS essai : **sortie du cron** le 16/11 (`automated: false`, N3 #1048, décision de Greg du 15/11), gardée pour l'admin. À repenser autour de l'essai : #1058. L'e-mail J+11 de B2 prend le relais.

<!-- Origine : prisma.md · Essai Premium d'inscription (#769, 2026-10-26) · 2026-10-26 -->
> **Origine** : `prisma.md` · « Essai Premium d'inscription (#769, 2026-10-26) » · 2026-10-26

## Essai Premium d'inscription (#769, 2026-10-26)

Migration `20261026120000_signup_trial` (additive, compatible N-1) : enum `TrialSource` (`SIGNUP`,
`ADMIN`) et colonnes nullables `User.trialSource`, `signupTrialEndsAt` (fin de l'essai d'inscription,
jamais modifiée), `trialEndHandledAt` (fin traitée par le cron) et `keptAccountId` (compte gardé actif
en gratuit, **sans clé étrangère** : un id périmé ou non ACTIVE vaut « le plus ancien ACTIVE »).
Rattrapage dans la migration : `trialSource = ADMIN` pour tout `trialEndsAt` existant (seul l'admin
l'écrivait) et `trialEndHandledAt = now()` pour les fins déjà passées. Détails : nestjs.md.

Migration `20261027120000_founder_first_paid` (#769, B1, additive) : `FounderSeat.firstPaidAt`
(premier paiement réel ; null = place réservée pendant le Premium offert, pas encore payée).
Rattrapage : `firstPaidAt = takenAt` pour les places existantes (toutes payées à la prise de place).

Migration `20261113150000_referral_discount_since` (#954, additive, nullable, compatible N-1) :
`User.referralDiscountSince` = début de la remise filleul −10 %, écrit par le webhook d'abonnement,
lu par le MRR base (12 mois). Pas de rattrapage SQL : la base ne sait pas quels abonnés l'ont eue.
