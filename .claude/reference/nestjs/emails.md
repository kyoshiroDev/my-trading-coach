# E-mails Resend et suite d'onboarding

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · E-mails Resend : débit, quotas, volume (2026-10-01) · 2026-10-01 -->
> **Origine** : `nestjs.md` · « E-mails Resend : débit, quotas, volume (2026-10-01) » · 2026-10-01

## E-mails Resend : débit, quotas, volume (2026-10-01)

- **Tout envoi passe par `ResendService.send()`** (ou une méthode `send*` qui l'appelle) :
  - `rate_limit_exceeded` (Resend : **10 requêtes/s par équipe**) → 3 nouveaux essais (1 s, 2 s, 4 s) ;
  - tout autre échec → `logger.error` **et Sentry** (`fingerprint ['resend-send-failed', <erreur>]` :
    un quota dépassé = une seule issue ; `daily_quota_exceeded` / `monthly_quota_exceeded` en `fatal`) ;
    `extra` = `{ name, statusCode, attempts, queued }`, ni le message de Resend, ni l'objet, ni le destinataire ;
  - jamais de throw (un e-mail raté ne fait pas échouer un job) ;
  - compteur du jour `resend:sent:<AAAA-MM-JJ UTC>` dans Redis ; au **80e** envoi
    (`RESEND_DAILY_WARN`), alerte Sentry de niveau **`error`** (la règle d'alerte n'envoie d'e-mail que pour la priorité haute ; `warning` = priorité moyenne = aucune notification) : seuil décidé pour passer du plan gratuit
    (100/jour) au plan Pro. Redis en panne → l'envoi part quand même.
- **Pas de `Promise.all` sur une liste d'utilisateurs qui envoie des e-mails** :
  `mapWithConcurrency(items, 4, fn)` (`common/utils/concurrency.util.ts`). Récap quotidien et
  rappels de renouvellement corrigés (ils tiraient tous les envois en même temps → 429 perdus).
- **Pas d'adresse e-mail complète dans les logs** : `maskEmail()` (`j***@gmail.com`) ; un cron
  logue un **nombre**, pas la liste des destinataires.
- **Identité visuelle** (`templates/index.ts`, oct. 2026) : `emailWrapper(content, preheader, accent)`
  pose une barre pleine largeur en haut (`ACCENT.brand` par défaut ; `alert` = reset mot de passe et
  paiement échoué ; `success` = paiement reçu et récap/débrief positif ; `discord` = invitation
  Discord), puis le logo **PNG** `logo-email.png` (80 px affiché en 40 px, servi par l'app de
  l'environnement : `${FRONTEND_URL}/logo-email.png`). Pas de SVG inline : Gmail et Outlook le
  retirent. Fond sombre forcé (`color-scheme: dark` + `bgcolor` sur body/div/table, Gmail retirant
  le style du `<body>`) : sans ça, fond blanc sur mobile. **Exception assumée** : l'app Gmail
  iOS en mode sombre inverse toutes les couleurs (l'email sombre devient clair, texte foncé, lisible).
  Décision du 2026-10-04 : on laisse faire, pas de hack `mix-blend-mode` (fragile, texte illisible
  hors blanc). Apple Mail et Gmail web/PC gardent le fond sombre. Typo = celle de l'app et de la
  landing (`FONT` Inter, `BRAND_FONT` Space Grotesk, `MONO` JetBrains Mono). CTA primaire unique :
  `cta()` (dégradé `135deg #3b82f6 → #8b5cf6`), jamais de bouton stylé à la main.
- **Reçu de paiement** (`invoice.payment_succeeded` → `sendPaymentSucceeded`) : seulement pour les
  renouvellements. Pas pour `billing_reason === 'subscription_create'` (le mail de bienvenue Premium
  couvre la souscription) ni pour une facture à 0. Carte (`invoicePayments.list`, best-effort),
  facture (`hosted_invoice_url`) et échéance (`syncSubscription().currentPeriodEnd`) sont
  optionnelles : une info absente = ligne masquée, jamais d'envoi bloqué.

<!-- Origine : nestjs.md · Suite d'e-mails d'onboarding (oct. 2026, NinjaTrader mi-novembre) · 2026-10-19 -->
> **Origine** : `nestjs.md` · « Suite d'e-mails d'onboarding (oct. 2026, NinjaTrader mi-novembre) » · 2026-10-19

## Suite d'e-mails d'onboarding (oct. 2026, NinjaTrader mi-novembre)

Moteur unique : registre `resend/campaigns/campaign-registry.ts`, `EmailDispatchService` (seul point de
décision), cron `AutoCampaignsCron` (10 h Paris, prod, worker cron), journal `EmailSend`.
- **Trois types** : `transactional` (jamais filtré), `marketing` (consentement + plafond), **`service`**
  (aide à utiliser le compte gratuit, intérêt légitime 6.1.f) : SANS consentement, MAIS désinscription
  propre (`User.serviceEmailsOptOutAt`) et **même plafond** que le marketing. Un e-mail de service ne
  parle JAMAIS d'offre payante. Pied `serviceFooter` (« Ne plus recevoir les e-mails d'aide au démarrage », lien
  `…/emails/unsubscribe?token=…&scope=service` → ne coupe que les conseils). Le lien marketing
  (sans `scope`) coupe marketing ET conseils. Profil : activer le consentement rétablit les conseils,
  le couper les arrête, **seulement si la valeur change** (le profil la renvoie à chaque enregistrement).
- **Désinscription en un clic** (RFC 8058, #791) : `EmailDispatchService.dispatch` ajoute
  `List-Unsubscribe: <url>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` aux e-mails
  `marketing` et `service` (même URL, même portée que le lien du texte), JAMAIS aux transactionnels.
  `EmailJob.headers` est transmis tel quel à Resend par `deliver` (et survit à la file BullMQ).
  `POST /api/emails/unsubscribe?token=…[&scope=service]` (public, 200 sans corps, réponse neutre
  si jeton inconnu, `@Throttle` 120/min : les appels viennent des serveurs Gmail/Yahoo) ; le `GET`
  reste pour le lien du texte et les anciens e-mails. Un envoi hors `dispatch` (`ResendService.send`
  direct) n'a pas d'en-tête : n'y faire passer que du transactionnel.
- **Retrait du consentement** (#747) : la désinscription et le réglage coupé gardent
  `marketingConsentAt` et datent `marketingConsentWithdrawnAt` (seulement s'il y avait consentement).
  Jamais remettre `marketingConsentAt` à null.
- **Lien de désinscription d'un contenu fourni par l'admin** (annonce) : passer à `dispatch` un
  override en FONCTION `(unsubUrl) => contenu`, construit après `ensureUnsubToken`. Construire l'URL
  avant avec `user.unsubToken ?? ''` donnait un lien `?token=` mort pour un compte sans jeton (#747).
- **Envoi manuel d'une campagne (admin)** : un seul à la fois par type, verrou Redis `email-campaign:send:<type>` (`SET NX EX` 2 h, rendu seulement par son propriétaire) ; un 2e envoi pendant le 1er → 409 (#1063). Redis indisponible : envoi autorisé.
- Aucun envoi de masse hors du moteur de campagnes : pas de script qui lit la base et appelle Resend
  (`send-discord-invite.mjs` supprimé, #747 : ni consentement, ni démo, ni désinscription). Une
  invitation Discord passe par la campagne `discord_invite`.
- **Plafond** : 1 e-mail marketing OU service / `MARKETING_COOLDOWN_DAYS` (4) par personne, à
  **1 h près** (`CAP_TOLERANCE_MS`) : le cron examine les campagnes par priorité, un e-mail plus
  prioritaire que le précédent est vu quelques secondes avant 4 j pile et glissait d'un jour. Une
  seule campagne par personne et par passage.
- **Suite** (priorité · type · fenêtre d'âge) : `connect_tradovate` 100 · service · J1-J14 (aucune
  connexion broker CONNECTED ni trade) ; `prop_firm_rules` 90 · service · J4-J21 (compte ACTIVE
  EVALUATION/FUNDED sans plan, `planLinkChoice` null ou LATER) ; `founder_followup` 60 · marketing · J10-J30
  (exclusions de `founder_launch` + FREE + pas de `founder_launch` reçu ; offre ouverte avec places
  vérifiée À L'ENVOI) ; `profile_reminder` 45 · J3-J14 ; `discord_invite` 40 · J5-J21.
  **Essai Premium en cours exclu** (#769, `notInTrial(now)` : `trialEndsAt` nul ou passé) de
  `first_week_recap`, `founder_followup` et `premium_upsell` : le plan reste FREE pendant l'essai.
  `first_trade_nudge` : `automated: false` (admin seulement). `first_week_recap` (80 · marketing · J7-J14,
  FREE hors essai, bilan J0-J7) : `automated: false` depuis le 16/11 (N3 #1048) : avec l'essai de
  14 jours, elle ne visait plus personne ; admin seulement, à repenser (#1058).
- **« Notifications email » (Profil, `notificationsEmail`)** commande 3 e-mails : le débrief hebdo,
  le récap de 17h30 (N1 #1048) et le rappel « Ton Premium se termine le {date} » (J-7, `resend.cron`).
  « Alertes importantes » du libellé = ce rappel. Paiement, essai et campagnes n'en dépendent pas : un
  nouvel e-mail ne s'y rattache pas par défaut. Bienvenue (`welcomeFreeTemplate`,
  transactionnel, envoyée par `createAccount` : e-mail ET Google) = 3 étapes.
- **Toute campagne automatique a une fenêtre d'âge** (`ageWindow(now, min, max)`, borne basse ET
  haute) : jamais d'envoi en masse vers d'anciens inscrits. Les 4 nouvelles exigent en plus
  `createdAt >= ONBOARDING_SEQUENCE_START` (date ISO, env de l'API) ; absente ou invalide → elles ne
  ciblent personne et le cron l'écrit en `warn` à chaque passage.
- **Données à l'envoi** : `loadContext(deps, userIds, now)` sur la campagne, appelé UNE fois par page
  de 500 autorisés (cron et envoi admin) ; un id absent de la Map = pas d'envoi (pas de trade J0-J7,
  offre fermée). `loadFirstWeek` = une requête SQL groupée (trades clôturés, jours de Paris, P&L net
  arrondi comme les stats, devises mélangées → montant sans symbole). Le cron est dans
  `AutoCampaignsModule` (importe `FounderOfferModule`, qui importe déjà `ResendModule`).
- **Liens** : `onboardingLink(appUrl, path, clé)` → `utm_source=email&utm_medium=onboarding&utm_campaign=<clé>`
  (bienvenue = `welcome`). Connexion Tradovate et firme → `/accounts` ; CSV → `/journal` ; Premium →
  `/dashboard?plan=premium&cta=email` ; fondateur → `/dashboard?plan=founder&cta=email` (les
  destinataires ont un compte : pas `/register` comme la landing). Prix, essai, places, délai de
  remboursement : `@mtc/shared` uniquement (un test lit le source et refuse tout montant littéral).
- **Admin** : la suite est en tête de la liste ; `sentTotal` (EmailSend) et, pour `connect_tradovate`,
  `connectedWithin3d` (envois de plus de 3 j suivis d'une `BrokerConnection` créée sous 3 j, une
  requête SQL). Aperçu / test : données communes réelles (firmes, places), bilan d'exemple.
- **Pied commun** (`emailWrapper(content, preheader, accent, _unsubUrl?)`) : TOUJOURS « Gérer mes
  e-mails » → `${FRONTEND_URL}/profil?tab=params` (décision du 28/10, #769). Un seul lien qui désinscrit
  par e-mail : celui du texte (`serviceFooter` ou `marketingFooter`) ; le pied ne répète plus la même URL
  sous « Se désabonner » (libellé trompeur : un lien de service ne coupe que l'aide au démarrage).
  Garde : `email-unsub-links.spec.ts`. Aucun lien ne coupe les e-mails de paiement (transactionnels). Plus aucun lien en dur vers l'app de prod. Garde :
  `email-links.spec.ts` vérifie que chaque lien vers l'app (code et rendu des campagnes) mène à une
  route déclarée dans `app.routes.ts` (ex-liens morts `/parametres`, `/trades`).
- Tests : `campaign-registry.spec.ts` (segments évalués en mémoire par `src/test/prisma-where.ts`),
  `onboarding-templates.spec.ts` (règles d'écriture), `onboarding-sequence.simulation.spec.ts` (VRAI
  cron + dispatch sur 21 jours, 6 profils : modifier une priorité ou une fenêtre = mettre à jour le
  calendrier attendu).

## Tirage mensuel (#1150, 2026-11-21)

E-mails du tirage vus par les traders envoyés depuis **contact@** (`GIVEAWAY_FROM`,
`resend/campaigns/giveaway-templates.ts`) : gagnant (transactionnel), `giveaway_ending` (service,
registre, 3 jours avant la fin du Premium gagné, hors plafond, cooldown), annonce à l'activation
(marketing hors registre, consentement respecté, hors plafond, une par activation). Détail :
`commun/tirage-mensuel.md`.
