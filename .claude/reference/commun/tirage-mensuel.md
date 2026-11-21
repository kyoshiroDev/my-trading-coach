# Tirage au sort mensuel (PROMPT-tirage-mensuel, #1150)

> Décisions : `decisions.md` du 2026-11-20 et du 2026-11-21. Lot A (données, tirage, attribution,
> admin, PR #1164) ; lot B (onglet « Concours du mois », page gagnant, landing, règlement, #1158) ;
> lot C (publication Instagram via Metricool).

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
  BETA_TESTER), compte de plus de `GIVEAWAY_MIN_ACCOUNT_AGE_DAYS` jours. Pas de critère « e-mail vérifié »
  (décision du 21/11 : `emailVerifiedAt` n'est posé que par la connexion Google, aucune vérification pour
  les inscriptions par e-mail).
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

## Verrou d'activation en prod (ouvert au lot B, gardé comme coupe-circuit)
`GIVEAWAY_PROD_ACTIVATION_OPEN` (`giveaway-settings.service.ts`) vaut **`true`** depuis le lot B
(21/11, même commit que la politique de confidentialité, condition de security). Le remettre à
`false` (changement de code relu) referme l'allumage en prod : en prod (`FRONTEND_URL` absent ou égal
à l'app de prod, normalisé), **allumer** répond alors 409 « Activation en prod fermée pour le
moment. » ; éteindre reste toujours possible et les tirages déjà allumés ne sont pas touchés ; hors
prod, l'activation est toujours libre. `GET /admin/giveaway` renvoie `activationAvailable` :
l'interrupteur éteint est alors désactivé et expliqué dans l'admin. Avant d'allumer un tirage en
prod, Greg valide `/reglement-tirage` et la section 1 h) de la politique de confidentialité.

## Cas assumés (relecteur du 21/11)
- Lot gratuit attribué par-dessus une offre de l'admin en cours : l'origine passe à GIVEAWAY sur
  toute la période, les jours offerts par l'admin ne sont plus retirables (ils font partie du lot).
- Gagnant pendant son essai d'inscription : il perd le report du premier prélèvement fondateur
  (`founder-deferred.ts` ne reporte que SIGNUP), comme pour un Premium offert par l'admin.
- BETA_TESTER abonné payant : reste éligible au tirage Premium (exclu seulement du tirage gratuit,
  décision du 21/11) ; il paie, l'avoir a une valeur.
- Cron sans verrou Redis : la contrainte unique (période, tirage) et le worker cron unique
  suffisent ; deux lancements simultanés = un tirage, au pire deux lectures Stripe.

## Lot B : app, landing, règlement (#1158)
- **API** : `GiveawayPublicService`. `GET /public/giveaway` (public, `Cache-Control: public, max-age=60`,
  Redis 60 s `giveaway:public-state`, vidé par l'allumage, la modération et les réglages du gagnant) :
  tirages allumés, lots, seuil, prochain tirage, compteurs (lots APPLIED), 12 derniers gagnants (nom
  selon l'accord, message seulement VALIDE). `GET /giveaway/state` : même état + `me` (tirage concerné :
  abonné actif = PREMIUM, sinon FREE ; raison `in` / `need_trades` / `premium_too_recent` (lecture
  Stripe, cache 1 h) / `account_too_recent` / `recent_winner` / `cancel_scheduled` / `pool_off` /
  `not_eligible` ; trades du mois civil en cours) + `myWin`. Démo : état réel des interrupteurs
  (onglet seulement si un tirage est allumé ; sinon raison `pool_off`), aucun gagnant ni message. `PATCH /giveaway/me/win` : message modifié → EN_ATTENTE.
- **App** : `GiveawayStateService` (chargé par la barre latérale à la connexion, rechargé à chaque
  ouverture de la page, vidé à la déconnexion). Dès qu'un tirage est allumé (démo comprise), l'entrée « Score trader » devient
  « Concours du mois » (`nav-concours`, icône cadeau, même place) ; `/scoring` reste joignable.
  Pages `/concours` (lots, compte à rebours, statut + progression, compteurs ou « Premier tirage le… »,
  gagnants, conditions, lien vers le règlement) et `/concours/gagnant` (lot, affichage, message,
  Instagram décoché par défaut).
- **Landing** : `PfGiveaway.astro` sur `/prop-firm`, cachée par défaut, affichée côté navigateur si
  `enabled` ; `/reglement-tirage` (noindex, hors sitemap), valeurs tirées de `@mtc/shared`.

## Lot C : publication Instagram (#1150)
- **Bouton « Publier »** (onglet admin, colonne Instagram) seulement si : accord Instagram, lot APPLIED,
  message absent ou VALIDE, pas déjà publié. Même règle côté API (`GiveawayInstagramService`, 409 sinon).
- **Aperçu** `POST /admin/giveaway/wins/:id/instagram/preview` (Throttle 6/min) : légende rédigée par
  Claude (`AI_MODELS.fast`, consigne fixe en cache + `COMPLIANCE_RULE`, `AnthropicClientService` = coût
  dans `AiUsageLog`, feature `giveaway_instagram`, `guardAiText`), puis `checkCaption` (aucun prix,
  aucun terme interdit, tirets remplacés, 5 hashtags au plus). IA coupée, en erreur ou sortie écartée →
  légende de repli (`fallbackCaption`, `aiGenerated: false`). Visuel : gabarit fixe
  (`giveaway-instagram.template.ts`) rendu en PNG 1080×1350 par `PdfService.renderPng` (même
  Chromium et même file que les PDF), stocké 24 h dans Redis sous un jeton aléatoire de 48 caractères,
  servi par `GET /public/giveaway/image/:jeton.png` (`Cross-Origin-Resource-Policy: cross-origin` sur
  cette seule route).
- **Publication** `POST /admin/giveaway/wins/:id/instagram/publish` : légende relue (recontrôlée),
  image de l'aperçu seulement, heure facultative (sinon dans 2 minutes). Réservation atomique avant
  l'envoi (`updateMany` sur `publicationStatus` ≠ PUBLISHED) : jamais deux posts pour un lot ; échec →
  FAILED (réservation annulée) et 502 ; l'admin ne passe en publication manuelle que sur ce 502 (ou 503 : Metricool non configuré)
  (409 = déjà publié → rechargement ; 400 = heure ou légende à corriger). Post parti mais lien non
  écrit → reste PUBLISHED. `MetricoolClient` : image
  copiée chez Metricool (`normalize/image/url`) puis post programmé avec `autoPublish`. Statut
  `PUBLISHED` (lien si Metricool le renvoie) ou `FAILED`. Variables `METRICOOL_API_TOKEN`,
  `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID` : absentes ou refus de Metricool → l'admin propose « Ouvrir l'image »
  et « Copier la légende ». Sans `API_URL` hors prod : erreur (pas d'URL d'image vers la prod). Erreurs Metricool : code HTTP seulement, jamais le corps.
- Politique de confidentialité : Metricool et Instagram ajoutés aux destinataires (section 4).

