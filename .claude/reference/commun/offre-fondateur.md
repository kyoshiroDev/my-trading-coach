# Offre fondateur et codes partenaires (#525)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md`, `.claude/agents/plans.md`, `.claude/agents/prisma.md`, `.claude/agents/security.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Offre fondateur (#525, 2026-10-07) · 2026-10-07 -->
> **Origine** : `nestjs.md` · « Offre fondateur (#525, 2026-10-07) » · 2026-10-07

## Offre fondateur (#525, 2026-10-07)

`modules/founder-offer/` : `FounderOfferService` (config, `seatsLeft` caché 30 s, `eligibility`,
`reserve`, `claimSeat`, `markLost`, `refundFirstPayment`, paliers), `FounderAdminService`, routes
publique + admin. **Anti-survente** : toute prise de place est une transaction qui commence par
`pg_advisory_xact_lock(525001)` (PgBouncer en mode session : OK). Checkout fondateur → réservation de
35 min (session Stripe 30 min) ; 1er `invoice.payment_succeeded` (`billing_reason = subscription_create`)
→ `claimSeat` (numéro = max jamais attribué + 1, idempotent ; `null` = pas de place → abonnement annulé +
alerte admin). Checkout : **une session par offre** (metadata `offer` + `priceId`, les autres sessions
ouvertes sont expirées et leur réservation rendue), aucun essai / coupon / `allow_promotion_codes` en
fondateur. `custom_text.submit` au-dessus du bouton de paiement : fondateur (remboursement 14 j, tarif
perdu si résiliation) et code partenaire (conditions figées) ; rien au prix normal. Le rendu de la page
(logo, nom, couleurs) vient du Branding du compte Stripe et du nom / de la description / de l'image du
produit, pas du code. **Page de paiement de l'app** : `POST /billing/checkout` avec `ui: 'elements'`
→ session `ui_mode: 'elements'` créée en version d'API `2026-08-26.dahlia` (option PAR APPEL,
`ELEMENTS_API_VERSION` ; le client reste en 2024-06-20), `payment_method_types` = NOTRE liste (carte, Link, Klarna) croisée avec les moyens activés sur le compte
(config par défaut, cache Redis 10 min) : un moyen désactivé est retiré, la carte reste toujours,
`return_url` = `/dashboard?checkout=success&session_id=…`, pas de `custom_text` ni de codes promo
manuels ; renvoie `{ clientSecret, publishableKey, summary }` (récapitulatif : offre, montants,
essai, code, places). Sans `STRIPE_PUBLIC_KEY` → repli `{ url }` (page Stripe). Une session ouverte
n'est reprise que pour la même page (`metadata.ui`) ; la clé d'une session `elements` se relit en
dahlia. Webhooks ajoutés : `checkout.session.expired` (réservation rendue), `charge.refunded`
(remboursement INTÉGRAL du 1er paiement réel, quel que soit le délai, rapproché par facture ou
PaymentIntent → place fondateur ou utilisation du code rendue + abonnement annulé ; partiel ou
renouvellement : rien). `syncSubscription` n'écrase jamais
l'abonnement ACTIF d'un user par un autre abonnement INACTIF (bascule essai → fondateur). Concurrence
testée sur vraie base : `founder-offer.int-spec.ts`. Nouveau module importé par `StripeModule` →
le stubber dans `app-role-wiring.spec.ts`.
**E-mails transactionnels (#525, phase F)** : 1er paiement fondateur → `sendFounderWelcome` (« Tu es
fondateur n° X », prix, fin du remboursement à 14 j) ; 1re facture avec code partenaire →
`sendPartnerWelcome` (conditions figées, essai) ; `checkout.session.completed` d'une offre `founder` /
`partner` → PAS de bienvenue Premium générique (pas de doublon) ; `invoice.payment_failed` d'un
fondateur ou d'un code partenaire actifs → `sendTariffAtRisk` (« ton tarif est en jeu », lien
`/profil?tab=params`) au lieu de l'e-mail d'échec générique ; `invoice.upcoming` d'un abonnement
ANNUEL → `sendAnnualRenewalReminder` (montant réel `amount_due`, date, tarif conservé). Le cron du
rappel à J-7 exclut donc les annuels (`stripeInterval` ≠ `year`). ⚠️ `invoice.upcoming` doit être
abonné sur les endpoints Stripe (à faire en prod au déploiement) et son délai réglé dans le dashboard.

Codes partenaires : `modules/partner-codes/` (`PartnerCodeService`, verrou `pg_advisory_xact_lock(525002)`
pour la dernière utilisation, réservation `CheckoutReservation` kind `PARTNER`). Checkout : `promo` dans
`CreateCheckoutDto` → offre `partner` (metadata `partnerCode`), prix normal + `discounts` du coupon de
l'intervalle. Le module fournit son propre `stripeClientProvider`. Concurrence testée sur vraie base :
`partner-code.int-spec.ts`. MRR : `UsersService.realMrr` (base) et `monthlyOf` après remise (admin).

Admin (#525, phase E) : `GET /admin/users/subscriptions` renvoie l'objet BRUT (l'intercepteur ajoute
`{ data }` ; l'ancien `{ data: { … } }` donnait `{ data: { data } }` et faisait planter la page admin
Abonnements) et inclut `founderSeat` / `partnerRedemption` pour le montant réel. Forme = contrat `AdminSubscriptionsData`
de `@mtc/shared` (#1102, avec `AdminUser` et `AdminFoundersData`) : `stripeTotal`, `pausedUsers`, `trialUsers`
toujours présents, plus de champ `total` ; accès manuels, essais et pauses bornés à `TRIAL_LIST_MAX` (200). `AdminUserDetail.offer`
(fondateur : numéro, statut, intervalle, dates, cta ; code : conditions figées, statut). Digest
quotidien (`signup-digest.cron.ts`) : ligne `offerDigestLines` (« Fondateurs : X / 200 (N actifs) ·
Codes partenaires : TRADER10 4/10… ») + « Palier atteint : 50 places » ; un palier franchi envoie le
digest même sans inscription.

<!-- Origine : angular.md · Offre fondateur et codes partenaires (#525, 2026-10-08) · 2026-10-08 -->
> **Origine** : `angular.md` · « Offre fondateur et codes partenaires (#525, 2026-10-08) » · 2026-10-08

## Offre fondateur et codes partenaires (#525, 2026-10-08)

- **Offres de l'utilisateur** : `OffersStore` (core/stores) ← `GET /billing/offers` (offre ouverte +
  places, place fondateur, éligibilité, `refundUntil`, code partenaire actif, intervalle). Chargé À LA
  DEMANDE (`load()` : modale, cadenas, Profil), une fois par utilisateur, `refresh()` après paiement /
  changement d'intervalle, délai max 10 s (une session périmée ne le fige pas). Pas dans `/auth/me`
  (interrogé toutes les 5 min). Démo : jamais chargé. **`status`** (#578) : `idle` (rien demandé :
  déconnecté, démo) · `loading` · `loaded` · `error` ; un rafraîchissement d'offres déjà là reste
  `loaded`. `load({ silent: true })` / `refresh({ silent: true })` : requête en `SILENT_ERRORS` (pas de
  toast), réservé à la modale et au chargement anticipé qui l'alimente ; Profil et cadenas gardent le toast.
- **Chargement anticipé** (#578) : dès la réponse de l'inscription (`RegisterComponent`, si `offerFlow()`)
  ou de la connexion (`LoginComponent`, si `needsChoice()`), `offersStore.load({ silent: true })` en
  parallèle de la navigation ; sur `/register` avec un lien d'offre, le code de la modale est importé
  quand le navigateur est inactif (`whenIdle`, même chunk que le `@defer` de l'hôte). `/billing/offers`
  exige un compte : impossible de charger avant l'inscription. Un échec du chargement anticipé est
  rattrapé sans bruit par le `load()` de la modale à son ouverture.
- **Intention du lien** : `OfferIntentService` capture `plan=founder|premium`, `promo`, `cta` au
  démarrage (`App`, avant toute redirection) en sessionStorage `mtc_offer_intent`. `plan=founder` ou
  `promo` → pas de checkout direct à l'inscription : `/dashboard`, puis `OfferIntentHostComponent`
  (monté dans le shell `sidebar`, modale en `@defer`) ouvre `mtc-plan-modal` avec `[preset]`.
  `plan=premium` seul → checkout direct comme avant. Déjà connecté sur `/register` avec une intention
  → `/dashboard`. Jamais pour un abonné `active` / `past_due` ni la démo. Compte déjà Premium
  autrement (admin, bêta, Premium offert, essai) venu d'un lien : modale seulement si
  `founderAvailable` (offres chargées), sinon intention oubliée — jamais de modale « 49 € » à
  quelqu'un qui a déjà Premium (lien de la campagne fondateur).
- **`mtc-plan-modal`** : entrées `cta` (défaut `modale`) et `preset`. Options exclusives (radio) :
  Fondateur (si `founderAvailable`), Code partenaire (une fois validé), Premium. Présélection : code du
  lien s'il est valide, sinon fondateur, sinon Premium ; un code saisi à la main et valide est choisi.
  Champ « Code partenaire » validé en direct (`GET /billing/partner/:code`, debounce 400 ms, raison
  précise du refus). Checkout : fondateur → `founder_*` sans `promo` ; code → `premium_*` + `promo`
  (jamais de cumul). Sous-titre, CTA et ligne de prix suivent l'offre choisie.
- **Aucun choix avant les offres (#578)** : `choice()` vaut `null` tant que `status` ≠ `loaded` →
  emplacements neutres (`.offer-skel`, aucun prix), CTA désactivé « Chargement des offres… », et
  `confirmPlan()` refuse aussi côté code (`canConfirm`). Avant le correctif, la modale s'ouvrait avant
  `/billing/offers` : seul « Premium 49 € » était proposé quelques centaines de ms et un appui partait en
  `premium_monthly` au lieu du fondateur demandé par le lien. Échec : `mtc-error-state` + « Réessayer »
  (`refresh({ silent: true })`), CTA masqué, jamais de repli silencieux sur le Premium.
- **Lien `plan=founder` sur une offre inaccessible** : la raison (`founderRefusal`, message
  `FOUNDER_INELIGIBLE_MESSAGES[ineligibleReason]` de `@mtc/shared`, le même que le refus du checkout),
  bloc `.offer-refusal`, et AUCUNE présélection (CTA « Choisis ton offre ») : le Premium n'est jamais
  choisi à la place du fondateur. Sans lien fondateur (cadenas, Profil) : présélection inchangée.
- **`mtc-premium-lock`** : bouton (plus un lien vers `/parametres`, route inexistante) →
  `OfferIntentService.open('cadenas')` : la modale est rendue par l'hôte du shell (un `position: fixed`
  dans une carte floutée serait mal placé). Libellé « dès 29 €/mois (offre fondateur) » si accessible.
- **Profil > Abonnement** : badge « Fondateur n° X », tarif bloqué et perte en cas de résiliation,
  « Satisfait ou remboursé : demander le remboursement » (mailto support@, jusqu'à `refundUntil` : le
  remboursement se fait dans Stripe, le webhook `charge.refunded` fait le reste), « Tarif partenaire
  CODE : … à vie / jusqu'au », bouton mensuel ↔ annuel (`POST /billing/interval`, confirmation), rappel
  neutre sous « Gérer mon abonnement » pour un fondateur / partenaire. Modale du Profil : `cta="profil"`.
  **Blocs selon `subscriptionState`** (#813) : Premium sans abonnement → « Premium offert » ; essai
  d'abonnement → « Essai gratuit… Premier prélèvement le » + « Gérer / annuler mon essai » ; annulation
  programmée (`stripeCancelAt`) → « Essai annulé » / « Abonnement résilié », date de retour au gratuit,
  sans bouton d'annulation ni mention de remboursement ; payant → « Renouvellement » ; en pause →
  « Paiement en attente » + « Confirmer mon paiement » (portail), jamais « Passer Premium ». Jours
  restants en jours de calendrier (`calendarDaysUntil`, comme le bandeau).
- Tests JIT : les entrées signal ne s'affectent pas par `setInput` → remplacer le signal d'entrée sur
  l'instance AVANT le premier `detectChanges` (`plan-modal-offers.spec.ts`).

### Admin : inscrits d'une campagne (#625)

Page Utilisateurs : le filtre vit dans l'URL (`/users?source=&medium=&campaign=`, relu à chaque
changement de `queryParamMap`), bandeau « Inscrits de … · N inscrits » + « Retirer le filtre ».
Entrées : Acquisition › Détail par campagne (« Inscrits total » cliquable, triplet exact via
`acquisitionQueryParams`, null → `-`) et la ligne « Acquisition » de la fiche utilisateur. Colonne
Abonnement : badge « Offert » pour un mois Premium offert (plan FREE + `trialEndsAt` futur).

### Admin : liaison compte ↔ plan prop firm (#612)

Dashboard, bandeau « Fidélisation & activation » : 6e stat `kpi-plan-links` (taux, reliés / connectés),
lien vers `/brokers`. Détail en tête de la page Brokers : `mtc-admin-plan-links-card` (réponses des
comptes sans plan, firms absentes du catalogue). Specs admin : builder Angular, `templateUrl` compilé
directement (pas de `?raw` comme dans l'app).

### Admin : offre fondateur et codes partenaires (#525)

- Dashboard : 7e KPI « Fondateurs » (`X / 200`, `N actifs · R restantes`, barre fine, badge « fermée »)
  → `/subscriptions?filtre=fondateurs`. La bande `dash-kpis` passe à 7 colonnes.
- Abonnements : KPI `cols-5` (+ Fondateurs) et onglets `section-tabs` Abonnements / Fondateurs /
  Codes partenaires, pilotés par `?filtre=fondateurs|codes`. Composants `founders-tab` (interrupteur
  « Ouvrir l'offre » avec confirmation DANS la page, date de fin, récap par clic, tableau filtrable et
  paginé, liens vers la fiche) et `partner-codes-tab` (formulaire création / modification, aperçu en
  une phrase, aide « effet sur l'annuel », liste « utilisés / max », activer / désactiver, abonnés par
  code). Styles partagés `offers-tabs.css` (champs repris de la page Ambassadeurs).
- Colonne « Montant » = montant réellement payé (`realAmountLabel`, `core/utils/offers.util.ts`, testé)
  + étiquette « Fondateur n° X » / « Code X ».
- Revenus : carte « MRR par tarif » (`mrrBreakdown` : normal / fondateurs / codes partenaires).
- Fiche utilisateur : badge « Fondateur n° X » ou « Code X », ligne avec date, intervalle et « Tarif
  perdu le … » / « Remboursé le … », ou conditions figées du code (`AdminUserDetail.offer`).
- Maquette `admin-mytradingcoach.html` absente en local au moment du #525 : design repris des
  composants existants (KPI, `.tbl`, `.badge`, `.section-tabs`, champs Ambassadeurs).

<!-- Origine : plans.md · Offre fondateur (#525, 2026-10-07) · 2026-10-07 -->
> **Origine** : `plans.md` · « Offre fondateur (#525, 2026-10-07) » · 2026-10-07

## Offre fondateur (#525, 2026-10-07)

Constantes : `FOUNDER_OFFER = { priceMonthlyEur: 29, priceAnnualEur: 290, seats: 200 }`,
`FOUNDER_ANNUAL_SAVINGS_EUR` (dérivée), `FOUNDER_REFUND_DAYS = 14`, `FOUNDER_MILESTONES`, `OFFER_CTAS`
(`libs/shared/src/pricing.ts`). Prix Stripe : `STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER` / `_YEARLY_FOUNDER`.

- **200 places**, mensuel (29 €) ET annuel (290 €) confondus. **Prix bloqué à vie** tant que
  l'abonnement reste actif ; tout le Premium, nouveautés futures comprises.
- Mensuel ↔ annuel fondateur autorisé (`POST /billing/interval`) : même place, même numéro.
- **Aucun essai** (premier paiement immédiat) ; l'essai 30 j du 49 € est inchangé (comptes antérieurs à #769 jamais essayés seulement, Q1 du 2026-11-14).
- **Réservation pendant l'essai d'inscription (#769, B1)** : essai d'inscription (`trialSource`
  SIGNUP) qui finit dans **49 h ou plus** (Stripe refuse un `trial_end` de Checkout à moins de 48 h,
  constaté en mode test le 27/10 : « at least 2 days in the future ») → Checkout avec `trial_end` =
  fin du Premium offert, carte obligatoire (`payment_method_collection: always`). La place est prise
  dès la facture d'essai à 0 € (`subscription_create`) ; `FounderSeat.firstPaidAt` reste vide jusqu'au
  premier paiement réel, qui arrive en facture **`subscription_cycle`** (pas `subscription_create`).
  Garantie de 14 jours à partir de `firstPaidAt`. Abonnement terminé sans paiement (refus, 3D Secure
  non confirmé, annulation avant la date) → place **RELEASED** et détachée du compte (`userId` null :
  le compte peut réserver de nouveau ; le numéro n'est jamais réattribué). Moins de 49 h : immédiat.
  Premium offert par l'admin (ou essai prolongé par lui, `trialSource` ADMIN) : **jamais de report**,
  prélèvement immédiat comme hors essai, et la fenêtre des offres affiche « jours offerts non reportés ».
  Comportement Stripe constaté (horloges de test) : refus de carte → `past_due`, 3 tentatives, puis
  `canceled (payment_failed)` entre J+10 et J+20 ; 3D Secure hors session → facture `open`,
  paiement `requires_action`, AUCUNE nouvelle tentative, même annulation → e-mail « Confirme ton
  paiement » sur `invoice.payment_action_required` (événement à inscrire aux 3 webhooks).
- **Satisfait ou remboursé 14 jours** sur le 1er paiement (engagement affiché). Côté code, **tout
  remboursement INTÉGRAL du 1er paiement, quel que soit le délai** (c'est Greg qui décide) → place
  `REFUNDED` (rendue), tarif perdu, abonnement annulé. Partiel ou renouvellement remboursé : rien.
  La charge est rapprochée de la 1re facture payée (> 0 €) par facture ou PaymentIntent.
- **Bascule** : un essai Stripe à 49 € ou un mois offert peut passer fondateur (prélèvement immédiat,
  l'essai est annulé au 1er paiement fondateur ; jamais de prolongation ni de cumul). Annulation ratée :
  alerte admin et nouvel essai automatique, jamais deux abonnements actifs (#1013 A7).
- **Lancement contrôlé** : `FounderOfferConfig.open` (fermé par défaut), `endsAt` optionnel. Fermé =
  personne d'éligible, `open: false` sur `GET /pricing/founder`, rien d'affiché.
- **Places** : prise au 1er paiement réussi (numéro 1 à 200, jamais réattribué). Rendue seulement si
  remboursement intégral du 1er paiement, 1er paiement en échec définitif, ou session Checkout expirée. Une résiliation
  ne la rend PAS. Exclus : démo, ADMIN, BETA_TESTER (une AMBASSADRICE est éligible).
- **Perte du tarif** : résiliation programmée = gardé jusqu'à la fin (réactivation = gardé) ;
  `past_due` = rien perdu (e-mail « ton tarif est en jeu ») ; perdu à `customer.subscription.deleted`
  (place `LOST`, reste comptée) ou au remboursement. Retour = prix normal.
- **Non-cumul** : fondateur, code partenaire et coupon de parrainage s'excluent ; le fondateur ne
  reçoit jamais le −10 % filleul (toujours moins cher sur la 1re année). Le −10 % filleul seulement
  au **premier** abonnement (A8 #1013) : aucun abonnement passé chez Stripe, aucune remise déjà notée. Le mois offert au PARRAIN
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

<!-- Origine : plans.md · Codes partenaires (#525, 2026-10-07) · 2026-10-07 -->
> **Origine** : `plans.md` · « Codes partenaires (#525, 2026-10-07) » · 2026-10-07

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
- **Libellé côté utilisateur** (#820) : une durée « à vie » s'affiche toujours « tant que ton abonnement
  reste actif » (`conditionsLabel` côté API, `PARTNER_FOREVER_LABEL` dans l'app), jamais « à vie » seul.
  L'admin garde « à vie » (usage interne).
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
  figées, pour les mois de remise **restants** seulement (B14 #1013, `intervalSwitchTerms`) : vers le
  mensuel, la remise mensuelle pendant ces mois ; vers l'annuel, la remise d'une année au prorata des
  mois restants (12 au plus ; à vie = entière). Même règle pour le −10 % filleul (coupon
  `mtc-referral-…`, remplace le coupon de 12 mois). Le Profil affiche le prix calculé par l'API
  (`/billing/offers` → `intervalSwitch`), jamais un prix recalculé côté front. Limite connue : un code
  de plus de 12 mois non multiple de 12 (ex. 18) remise aussi en entier la 2e facture annuelle
  (coupon `repeating` de 18 mois), alors que le Profil annonce « puis 490 €/an » : en faveur du trader,
  et déjà le cas avant.
- **MRR** (base et Stripe) sur le montant **réellement payé** : découpé `mrrBreakdown`
  normal / fondateur / partenaires / filleuls (`realMonthlyEur`). Le MRR Stripe déduit les remises
  (`expand: data.discounts`). Le −10 % filleul est compté dans le MRR base depuis #954 : le checkout
  pose la métadonnée d'abonnement `referralDiscount=1`, le webhook enregistre
  `User.referralDiscountSince` (`referralDiscountStart` : coupon développé, sinon métadonnée), et le
  MRR base applique −10 % pendant 12 mois (44,10 € / 441/12), puis le prix normal. Filleuls abonnés
  AVANT #954 : l'API Stripe épinglée en `2024-06-20` développe `discount` dans l'abonnement, donc les
  **mensuels** sont repris au renouvellement suivant (`customer.subscription.updated` →
  `syncSubscription`), sous un mois ; les **annuels** seulement à leur renouvellement, quand la remise
  est déjà finie : leur MRR base reste à 490/12 au lieu de 441/12 d'ici là. Aucun rattrapage (il
  faudrait lire Stripe live, jamais sans Greg). L'historique `MetricsSnapshot` n'est pas recalculé.
- Commission ambassadeur : 20 % de `invoice.amount_paid`, donc déjà sur le montant remisé. **Une
  commission par facture** (`ReferralCommission.invoiceId`, unique, A1 #1013) : jamais réécrite au
  rejeu, une ligne `paid` reste intacte. Remboursement intégral du 1er paiement du filleul (A4) :
  commission `pending` → `canceled` (ne compte plus nulle part, jamais marquable payée) ; `paid`
  gardée + alerte admin ; mois offert du parrain jamais repris + alerte admin.
- Code ambassadeur (A5) : changé → les filleuls suivent (même transaction) ; un code changé ou
  révoqué va dans `RetiredReferralCode` et n'est jamais redonné à un autre compte, ni choisi ni généré
  (un vieux lien créditerait le nouveau porteur) ; seul son ancien porteur peut le reprendre. Un code
  porté par des filleuls est refusé de même.
  Estimation mensuelle affichée à l'ambassadeur (`referralMonthlyCommission`, `ambassador-commission.util.ts`) :
  20 % de `realMonthlyEur` (fondateur, annuel ÷ 12, code partenaire), abonnements `active` seulement (#947).
  Filleul « Payant » sur la page Ambassadeur = même règle (`isPayingReferral`, champ `paying` de
  `/ambassador/stats`) : un essai ou une pause reste « Inscrit » (B12 #1013).
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

<!-- Origine : prisma.md · Offre fondateur et codes partenaires (#525, 2026-10-07) · 2026-10-07 -->
> **Origine** : `prisma.md` · « Offre fondateur et codes partenaires (#525, 2026-10-07) » · 2026-10-07

## Offre fondateur et codes partenaires (#525, 2026-10-07)

Migration `20261007192237_offre_fondateur`, additive. **Registres** plutôt que des champs copiés sur
`User` (choix justifié dans #525) :
- `FounderOfferConfig` : ligne unique (`CHECK id = 1`), insérée **fermée** par la migration
  (`open = false`, `endsAt` null, `notifiedMilestones` = paliers déjà notifiés).
- `FounderSeat` : `number` = PK (1 à 200, `CHECK >= 1`), **jamais supprimé ni réattribué** (le user
  supprimé → `userId` null, la place reste comptée). `status` ACTIVE / LOST (abonnement terminé, place
  gardée) / REFUNDED (1er paiement remboursé intégralement, place rendue) / RELEASED (1er paiement en échec, place rendue). Places
  prises = `status IN (ACTIVE, LOST)` + réservations FOUNDER non expirées, index `[status]`.
- `PartnerCode` (`code` en MAJUSCULES, unique) + `PartnerRedemption` (une par personne, `userId`
  unique, conditions **figées** à l'utilisation, coupon appliqué). Quota = redemptions non RELEASED +
  réservations PARTNER non expirées, index `[partnerCodeId, status]`.
- `CheckoutReservation` : anti-survente pendant la session Checkout (30 min), `stripeSessionId` unique.

<!-- Origine : security.md · Route publique de l'offre fondateur (#525) · 2026-10-07 -->
> **Origine** : `security.md` · « Route publique de l'offre fondateur (#525) » · 2026-10-07

## Route publique de l'offre fondateur (#525)

`GET /api/pricing/founder` : `@Public`, 60 req/min/IP, `Cache-Control: public, max-age=60` (60 s max,
derrière nginx et Traefik), lecture seule, **aucune donnée personnelle** (état de l'offre, places,
prix). CORS : origines globales (`CORS_ORIGINS` doit inclure `https://www.mytradingcoach.app`).

`GET /api/pricing/partner/:code` : `@Public`, **20 req/min/IP** (anti-énumération), paramètre tronqué à
40 caractères, ne renvoie ni le libellé (nom du partenaire) ni le nombre d'utilisations.
