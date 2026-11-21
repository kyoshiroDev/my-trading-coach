# Tirage au sort mensuel (PROMPT-tirage-mensuel, #1150)

> Décisions : `decisions.md` du 2026-11-20 et du 2026-11-21. Lot A (données, tirage, attribution,
> admin) ; lot B (onglet « Concours du mois », page gagnant, landing, règlement) et lot C
> (publication Instagram) à venir.

## Principe
- **Éteint par défaut.** Deux interrupteurs indépendants dans l'admin (« Tirages », `/tirages`) :
  tirage des gratuits et tirage Premium (`GiveawaySettings`, une ligne id = 1).
- Cron `GiveawayCron` le `GIVEAWAY_DRAW_DAY` à `GIVEAWAY_DRAW_HOUR` h (Europe/Paris), worker cron
  seul. Il ne tourne que pour les tirages allumés. **Aucun cron sur dev** : « Tirer maintenant »
  sert aux tests (`GIVEAWAY_MANUAL_DRAW=true` ET `FRONTEND_URL` différent de la prod, sinon 403).
- Toutes les valeurs (lots, seuils, jour, heure, carence, longueur du message) dans
  `libs/shared/src/giveaway.ts`. Jamais recopiées.

## Éligibilité (`GiveawayEligibilityService`)
- Commun : `REAL_USERS_WHERE` (ni démo, ni interne, ni ADMIN ; un compte supprimé n'a plus de
  ligne), au moins `GIVEAWAY_MIN_TRADES` trades (`tradedAt`, toutes sources, tous comptes) dans le
  **mois civil Paris écoulé**, pas gagnant (des deux tirages) depuis `GIVEAWAY_WIN_COOLDOWN_MONTHS`
  périodes (gagnant de P éligible de nouveau à P + 6).
- Gratuits : `PREMIUM_OFFERABLE_WHERE` (même règle que « Offrir Premium », testée équivalente à
  `premiumOfferRefusal` : pas d'abonnement actif / en essai / en pause, ni plan PREMIUM, ni ADMIN /
  BETA_TESTER), compte de plus de `GIVEAWAY_MIN_ACCOUNT_AGE_DAYS` jours, `emailVerifiedAt` non nul.
  Un essai d'inscription en cours n'exclut pas (le lot s'ajoute après). AMBASSADOR éligible.
- Premium : abonnement `active` (ni `trialing` ni `past_due`), `stripeCancelAt` vide, puis lecture
  Stripe des factures (seulement pour les candidats déjà actifs) : mensuel = au moins
  `GIVEAWAY_PREMIUM_MIN_PAID_INVOICES` factures payées > 0 ; annuel = premier paiement réel depuis
  au moins `GIVEAWAY_PREMIUM_MIN_PAID_MONTHS` mois civils (`premiumSeniorityOk`). Un client
  illisible chez Stripe est écarté du tirage, sans bloquer les autres.

## Tirage (`GiveawayDrawService`)
- Liste des éligibles triée par id, rang `crypto.randomInt`, trace d'audit (`eligibleHash` =
  sha256 des ids séparés par `\n`, `drawnIndex`). **Unique (`period`, `pool`)** : deux lancements
  (ou cron + bouton) ne font qu'un tirage (P2002 → « déjà tiré »).
- Aucun éligible : tirage enregistré avec 0, pas de lot, e-mail à l'admin.

## Lots (`GiveawayPrizeService`)
- **Gratuit** : `UsersService.grantGiveawayPremium` = mécanisme de « Offrir Premium »
  (`trialEndsAt` futur, plan FREE, fin gérée par `TrialEndService`), `trialSource = GIVEAWAY`,
  `GIVEAWAY_FREE_PRIZE_MONTHS` mois civils depuis `max(maintenant, trialEndsAt)`. Écriture
  conditionnelle (`PREMIUM_OFFERABLE_WHERE`). Jamais retiré : « Retirer le Premium offert » refuse
  un lot GIVEAWAY et, si l'admin a offert du Premium par-dessus, rend le lot encore en cours (fin
  la plus tardive entre le lot et l'essai d'inscription).
- **Premium** : avoir sur le solde client (`StripeGiveawayService.creditGiveaway`), jamais
  `trial_end` (statut d'essai, MRR, circuit fondateur). Montant `giveawayPremiumCreditCents` :
  3 × la dernière échéance réellement facturée (mensuel) ou 3/12 (annuel), remises comprises.
  Idempotent : métadonnée `giveawayWinId` retrouvée avant toute création + clé `giveaway-<winId>`.
- Échec (compte plus éligible, Stripe) : `activationStatus = FAILED` + `activationError`, e-mail à
  l'admin, bouton « Relancer l'attribution » (`POST /admin/giveaway/wins/:id/retry`, FAILED seulement).

## E-mails
- Expéditeur des e-mails vus par les traders : **contact@** (`GIVEAWAY_FROM`, décision du
  relecteur du 21/11), réponses dans contact@.
- Gagnant (transactionnel) : lot, date de fin, lien `/concours/gagnant` (page du lot B).
- `giveaway_ending` (service, registre des campagnes, cron 10 h prod) : 3 jours avant la fin du
  Premium gagné (`trialSource = GIVEAWAY`), hors plafond, cooldown (un gagnant peut regagner).
- Annonce à l'activation (marketing, hors registre) : une par activation (`*AnnouncedAt` posé par
  écriture conditionnelle), consentement marketing et désinscription respectés, hors plafond,
  pages de 500, verrou Redis, envoi en arrière-plan. Gratuits (même règle que le lot) ou abonnés
  actifs. Éteindre n'envoie rien et remet l'annonce à zéro.
- Admin : `sendAdminAlert` (noreply@ → hello@) pour chaque tirage (gagnant, éligibles, état du lot).

## Admin
- `GET /admin/giveaway`, `PATCH /admin/giveaway/settings`, `PATCH /admin/giveaway/wins/:id/moderation`,
  `POST /admin/giveaway/wins/:id/retry`, `POST /admin/giveaway/draw` (hors prod). `JwtAuthGuard` +
  `AdminGuard` au niveau de la classe. Contrat : `libs/shared/src/contracts/giveaway.ts`.
- Message du gagnant : rien d'affiché dans l'app tant qu'il n'est pas « Validé ».

## Suppression d'un compte
- `deleteMe` efface message, pseudos et accords des lots du compte ; `GiveawayWin.userId` et
  `GiveawayDraw.winnerId` passent à null (SetNull), le tirage et sa trace restent.

## Ne pas allumer en prod avant le lot B
Les e-mails (gagnant, annonce) renvoient vers les pages du lot B (`/concours`, `/concours/gagnant`).
