# PremiumGuard : logique d'essai

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · PremiumGuard — logique trial · 2026-04-25 -->
> **Origine** : `nestjs.md` · « PremiumGuard — logique trial » · 2026-04-25

## PremiumGuard — logique trial

```typescript
canActivate(ctx: ExecutionContext): boolean {
  const user = ctx.switchToHttp().getRequest().user;
  const isPremium = user.plan === 'PREMIUM';
  const inTrial = user.trialEndsAt && new Date() < new Date(user.trialEndsAt);
  if (isPremium || inTrial) return true;
  throw new ForbiddenException({
    code: 'PREMIUM_REQUIRED',
    trialAvailable: !user.trialUsed
  });
}
```

### Essai Premium d'inscription (#769, 2026-10-26)

- Posé dans `AuthService.createAccount`, **seul** point d'entrée des inscriptions e-mail et Google :
  `signupTrialData(now, recentlyDeleted)` (`modules/trial/signup-trial.ts`) → `trialEndsAt` et
  `signupTrialEndsAt` à J+`PREMIUM_SIGNUP_TRIAL_DAYS` (14, `@mtc/shared`), `trialSource = SIGNUP`,
  `trialUsed = true` (plus d'essai Stripe de 30 j ensuite, sans toucher au checkout).
- Refusé (mais `trialUsed = true` quand même) si l'e-mail, casse ignorée, a supprimé un compte depuis
  moins de 90 jours (`DeletedAccount.email`, non anonymisé, `ANONYMIZE_AFTER_DAYS`). Au-delà, aucune
  trace : pas de hash d'e-mail (décision du 26/10).
- Aucun nouveau chemin d'accès : tous les contrôles lisent déjà `trialEndsAt` (guard, débrief,
  comptes, import, Discord, alertes). Le compte démo ne passe pas par `createAccount` (seed).
- Premium offert par l'admin pendant l'essai : durées **additionnées**, `trialSource = ADMIN`,
  `signupTrialEndsAt` intact. `isOfferedPremium` exclut `SIGNUP` (l'admin n'affiche pas l'essai
  d'inscription comme un cadeau).
- Fin : `TrialEndService` (cron ci-dessous). Comptes en trop : `GET /accounts` renvoie
  `overFreeLimit` par compte (ACTIVE au-delà du quota gratuit, jamais en Premium) et
  `POST /accounts/:id/keep` enregistre le compte gardé (`User.keptAccountId`, ACTIVE seulement, sinon
  400 ; 404 si pas à l'utilisateur). Défaut : le plus ancien ACTIVE (`accounts/kept-account.ts`).
  Synchro des comptes en trop (B0) : **journal seul** pour l'instant. `FreeLimitSyncService.observe`
  (module Tradovate) est appelé par `TradovateSyncService.sync` (bouton, retour OAuth, cron de fond,
  rattrapage du direct) et `TradovateHistoryService.importHistory` : compte gratuit (ni Premium, ni
  essai, ni rôle, ni démo) dont le compte n'est pas le compte gardé → ajouté à l'ensemble Redis
  `free-limit-sync:<jour de trading>` (8 j) et une ligne de journal sans identifiant, une fois par
  compte et par jour ; rien n'est bloqué. Une erreur (base, Redis) ne bloque jamais, et l'évaluation
  rend la main en 1 s au plus (`OBSERVE_TIMEOUT_MS`, journal « TimeoutError ») : le client Redis n'a pas
  de `commandTimeout`, un Redis muet bloquerait sinon la synchro qui attend `observe`. Le bilan du cron de fond (15 min)
  ajoute « N compte(s) au-delà de la limite gratuite aujourd'hui (journal seul) ». Pour ACTIVER l'arrêt,
  il faudra aussi filtrer `TradovateLiveService.eligible` (WebSocket) et le relevé de solde.
- Relance des anciens inscrits : `tools/scripts/backfill/signup-trial-existing.ts --dry-run`, lancé
  par Greg seulement.
- **Réservation fondateur (B1)** : `founder-offer/founder-deferred.ts` (`founderFirstChargeAt`, 48 h + 1 h
  de marge, essai d'inscription `trialSource` SIGNUP seulement : Premium offert par l'admin = immédiat),
  `subscription_data.trial_end` au checkout, `summary.firstChargeAt` et
  `GET /billing/offers` → `founder.firstChargeAt` / `reservedUntilCharge`. La date est aussi dans les
  métadonnées de la session (`firstChargeAt`, secondes) : une session ouverte n'est reprise qu'avec la
  même date. Webhook : facture d'essai à 0 € → `claimSeat` + e-mail « place réservée » ; abonnement
  déjà terminé (`canceled` / `incomplete_expired`, fin reçue avant la facture) → aucune place pour une
  facture à 0 €, place prise puis `markLost` pour une facture payée ; toute facture fondateur > 0 € →
  `markFirstPaid` (idempotent) + bienvenue fondateur (garantie = `firstPaidAt` + 14 j) ;
  `customer.subscription.deleted` → `releaseUnpaid` (place non payée) sinon `markLost` ;
  `customer.subscription.updated` en `unpaid` → `releaseUnpaid` (réglage Stripe « marquer comme
  impayé ») ; `invoice.payment_action_required` (hors facture `subscription_create`, le 3D Secure s'y
  fait dans la page de paiement) → e-mail « Confirme ton paiement » avec `hosted_invoice_url`, Premium
  en pause (`past_due`). `invoice.payment_failed` à **0 tentative** = 3D Secure en attente (constaté en
  mode test le 27/10 : il arrive juste avant `payment_action_required` ; un refus de carte compte 1
  tentative) → pas d'e-mail d'échec. E-mails réservation et 3D Secure « une seule fois »
  (`sendOnce`, marque Redis `stripe:mail-once:*` 30 j, retirée si l'envoi échoue) : une tâche BullMQ
  rejouée ne les renvoie pas. Journaux : nom de l'erreur seulement. Bienvenue partenaire aussi
  derrière `sendOnce` (`partner-welcome:<sub>`) : `claim` rend l'utilisation existante au rejeu.
  **Bascule essai 49 € → fondateur** (#1013 A7) : `cancelSupersededTrials` passe EN DERNIER (après place,
  garantie, parrainage) et seulement si une place a été prise ; échec de la liste ou d'une annulation →
  alerte admin une fois (`sendOnce`) puis erreur (BullMQ rejoue). Paiement fondateur sans place : l'essai
  est gardé. `syncSubscription` ignore un AUTRE abonnement encore actif tant qu'une place fondateur
  `ACTIVE` pointe sur l'abonnement en cours (jamais l'essai à 49 € suivi à la place du fondateur).
  **Clés d'idempotence Stripe = mêmes paramètres** : checkout sans réservation
  `checkout-<user>-<offer>-<ui>-<price>-<expires_at>` (un créneau de 30 min avec un `expires_at` qui change
  → `idempotency_error` → 500) ; changement d'intervalle `interval-<sub>-<prix cible>-<latest_invoice>`
  (double clic = même clé, aller-retour dans les 24 h = nouvelle clé). Refus du passage à l'annuel pendant
  une réservation fondateur : « Changement impossible pendant ta réservation fondateur : tu pourras le
  faire après ton premier prélèvement, le JJ/MM. »
  `cta` du checkout (`CreateCheckoutDto`) : une valeur hors `OFFER_CTAS` est IGNORÉE (`@Transform` →
  `undefined`), jamais un 400 qui bloque le paiement.
  Premium offert par l'admin (`offerPremium`) : pose le rôle Discord Premium (si Discord lié, panne non
  bloquante) et vide `billing:status:<id>`. 409 si abonnement `active` / `trialing` (une réservation
  est en `trialing`) ou `past_due` / `unpaid` (« Paiement Stripe en attente : régler d'abord
  l'abonnement »). La fiche admin (`GET /admin/users/:id`) expose `offer.founder.reserved` et
  `firstChargeAt` ; l'admin affiche la raison sous le bouton désactivé (réservation : date du premier
  prélèvement).
- **Suivi admin de l'essai (B3)** : `GET /admin/funnel` → `signupTrial` (une requête, démo et ADMIN
  exclus, cohorte = `signupTrialEndsAt` non nul) : `inProgress` (fin à venir, pas `active`), `ended`
  (fin dans la période), `converted` (parmi `ended`, `active` aujourd'hui), `reservations` (place ACTIVE
  sans `firstPaidAt`), `reservationsAwaitingPayment` (`past_due` / `unpaid`), `nextChargeAt` (plus petit
  `stripeCurrentPeriodEnd` d'une réservation en `trialing`). Affiché en bande au-dessus de l'entonnoir
  Premium (page Acquisition). Test SQL : `admin/signup-trial-funnel.int-spec.ts`.
- **E-mails de l'essai (B2)** : campagnes `trial_ending` (priorité 120) et `trial_ended` (110), type
  `service` (sans consentement, désinscription « service », même plafond), bornées par
  `signupTrialEndsAt` et non par `createdAt` (un essai posé par le script de relance compte aussi).
  `trial_ending` : fin dans 3 jours au plus, pas prolongé par l'admin, ni abonné ni réservé ;
  `trial_ended` : du lendemain de la fin (15 h après) à J+6, plan FREE. Écart ≥ 4 jours avec J+11 au
  passage de 10 h, donc plafond respecté. J+11 (décision du 27/10) : service neutre, objet avec la date
  de fin (pas de compte à rebours), ce qui change en gratuit, bouton « Voir mon abonnement »
  (`/profil?tab=params`), sans offre ni urgence ; contexte `loadTrialEnd` (date seule). Évaluateur de
  test : `gt` / `lt`. Mention de bas des deux e-mails (décision du 28/10) : « Tu reçois cet e-mail parce
  que tu as un compte MyTradingCoach. » (`serviceFooter(unsubUrl, reason)`), pas « pour t'aider à
  démarrer ». Aperçu avant l'envoi réel : `tools/scripts/ops/preview-trial-emails.ts`.
- **Résiliation pendant l'essai d'inscription** (#845, `onSubscriptionDeleted`) : payer ou réserver
  ne met pas fin à l'essai (`trialEndsAt` gardé). Si l'essai continue plus d'une heure après la
  suppression de l'abonnement (`subscriptionState` = `signup_trial`), « Abonnement résilié » dit
  « Ton Premium offert continue jusqu'au JJ/MM » (heure de Paris) puis « Aucun prélèvement. » si
  l'abonnement n'a sûrement jamais été payé (place fondateur rendue, ou aucune facture payée), sinon
  « Aucun nouveau prélèvement. » ; jamais de remboursement évoqué. Sinon texte standard, enregistré
  dans `EmailSend` (`SUBSCRIPTION_CANCELED_EMAIL_KEY`, transactionnel) : `trial_ended` exclut ceux
  qui l'ont reçu dans les 7 jours (pas de doublon quand une réservation s'arrête à la fin de l'essai).
  Réservation jamais payée (`releaseUnpaid` a rendu une place) : alerte « Réservation fondateur
  annulée, place n° X rendue » au lieu de « Churn », pas de push « Annulation », pas de
  `subscriptionCanceledAt` (ce n'est pas un départ de client payant).
- E-mail de bienvenue (`sendWelcomeFree`, transactionnel) : `trialEndsAt` passé par `createAccount`,
  paragraphe « Tu as 14 jours de Premium offerts jusqu'au … » (aucun bouton, aucune offre) ; sans essai
  (réinscription récente), aucune mention Premium. Relances `first_week_recap` / `premium_upsell` :
  plus d'essai promis (`NO_TRIAL_LINE`).
