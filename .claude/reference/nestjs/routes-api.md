# Routes de l'API REST

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

## Contraintes imposées par Traefik prod (#1282, 2026-11-25)

- En-tête personnalisé : nom en lettres, chiffres et tirets seulement (Traefik supprime les autres,
  `aliasHeadersStrategy: delete`).
- Valeur libre (code, nom de fichier, texte) : en query ou dans le corps, jamais dans le chemin.
  Traefik renvoie 400 sur `%2F %5C %00 %3B %25 %3F %23` dans le chemin (`encodedCharacters`).
- Détail et procédure : `reference/deploy/maintenance-vps.md`, section « Durcissement des entrypoints Traefik prod ».

<!-- Origine : nestjs.md · API REST · 2026-04-25 -->
> **Origine** : `nestjs.md` · « API REST » · 2026-04-25

## API REST

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh

GET    /api/trades                     ?page&limit&side&setup&emotion&dateFrom&dateTo
POST   /api/trades                     → vérifier limite 30/mois FREE avant création
PATCH  /api/trades/:id
DELETE /api/trades/:id

GET    /api/analytics/summary                    FREE + PREMIUM (pas de PremiumGuard). ?from&to = periode glissante du dashboard (sans bornes = tout l'historique)
GET    /api/analytics/by-setup                   PREMIUM, ?from&to (période du dashboard / des Statistiques, #947)
GET    /api/analytics/by-emotion                 FREE (vue de base, donut du dashboard), ?from&to
GET    /api/analytics/by-hour                    PREMIUM, ?from&to
GET    /api/analytics/equity-curve               FREE
GET    /api/analytics/equity-curve/current-month FREE (carte equite dashboard, legacy ; mois dans la clé de cache)
GET    /api/analytics/equity-curve/daily         FREE, ?from&to → carte equite scopee periode
GET    /api/analytics/activity/range             FREE, ?from&to → P&L par jour du dashboard (agregation jour/semaine/mois cote front)
GET    /api/analytics/activity/current-month     FREE (activite mensuelle)
GET    /api/analytics/activity/:year/:month      FREE (donnée propre de l'utilisateur, analytics.controller.spec)
GET    /api/analytics/top-assets                 FREE (vue de base), ?from&to
GET    /api/analytics/daily-recap/yesterday      JWT → récap de la DERNIÈRE journée tradée sur 7 jours (le lundi : vendredi, #947)

POST   /api/session/start              JWT → démarrer une session, { mood: MoodState }
GET    /api/session/active             JWT → session active en cours (null si aucune)
GET    /api/session/today              JWT → session du jour : l'active, sinon la dernière clôturée aujourd'hui
GET    /api/session/history            JWT → séances clôturées ; chaque ligne porte `accountId`, `wins`, `losses` (computeTradeStats, net), #947
                                       (avec ses trades) — utilisée par l'app au chargement (#456)
POST   /api/session/:id/close          JWT → clôturer, { mood: MoodState, notes? }
POST   /api/events                     JWT + @DemoAllowed → événements d'usage { event, place } (liste blanche
                                       `PRODUCT_EVENTS` : entonnoir Premium, place = 1er segment de route ;
                                       installation de l'app, place = plateforme), 204, best-effort
GET    /api/admin/funnel               ADMIN (?includeTests) → visites → inscrits → Premium vu → offres → clic essai → retour Stripe ; signupTrial (#769, B3) ; démo (ouvertures, bandeau vu, relance, clics par placement)
POST   /api/public/funnel              PUBLIC (60/min/IP), 204 → étape du parcours d'inscription ou engagement landing { step, source?, medium?, campaign?, inApp?, detail?, path? }
GET    /api/admin/signup-funnel        ADMIN (?days=7|30, défaut 30) → visites + étapes par source/medium/campagne × inApp, erreurs par code
GET    /api/admin/landing-engagement   ADMIN (?days=7|30, défaut 30) → vues + défilement/temps/sélecteur de / et /prop-firm par page × source/medium/campagne
GET    /api/pricing/founder           PUBLIC (60/min, Cache-Control max-age=60) → { open, seatsTotal, seatsLeft, priceMonthlyEur, priceAnnualEur }
GET    /api/admin/founders            ADMIN → fondateurs paginés (?status, ?page) + totaux (pris, actifs, perdus, remboursés, restants, par cta)
PATCH  /api/admin/founder-offer       ADMIN → { open?, endsAt? } (interrupteur « Ouvrir l'offre »)
GET    /api/giveaway/state            JWT → page « Concours du mois » : état public + statut de l'utilisateur (raison, trades du mois) + son lot (démo : exemple, aucun gagnant)
PATCH  /api/giveaway/me/win           JWT → { displayConsent, displayPseudo?, message? (≤ 140), instagramConsent, instagramHandle? } ; message modifié → EN_ATTENTE (bloqué en démo)
POST   /api/admin/giveaway/wins/:id/instagram/preview  ADMIN → aperçu Instagram : légende (IA ou repli), visuel temporaire, metricoolAvailable
POST   /api/admin/giveaway/wins/:id/instagram/publish  ADMIN → { caption, imageUrl, publishAt? } → Metricool ; statut PUBLISHED / FAILED
GET    /api/public/giveaway/image/:jeton.png PUBLIC → visuel Instagram d'un gagnant (24 h, jeton aléatoire)
GET    /api/public/giveaway           PUBLIC → section de la landing : tirages allumés, lots, prochain tirage, compteurs, gagnants affichables (cache 60 s)
GET    /api/admin/giveaway            ADMIN → tirage mensuel : 2 interrupteurs (éligibles maintenant, destinataires de l'annonce), prochain tirage, historique (commun/tirage-mensuel.md)
PATCH  /api/admin/giveaway/settings   ADMIN → { pool, enabled } (allumer = annonce une fois par activation ; éteindre n'envoie rien)
PATCH  /api/admin/giveaway/wins/:id/moderation  ADMIN → { moderation: VALIDE | REFUSE }
POST   /api/admin/giveaway/wins/:id/retry       ADMIN → relance l'attribution d'un lot FAILED (avoir Stripe idempotent)
POST   /api/admin/giveaway/draw       ADMIN → { pool } tirage manuel, 403 en prod ou sans GIVEAWAY_MANUAL_DRAW=true
POST   /api/billing/checkout          plan premium_monthly|premium_yearly|founder_monthly|founder_yearly, cta?
POST   /api/billing/interval          { interval: month|year } → changement par NOTRE flux, tarif gardé
GET    /api/billing/offers            → { founderOffer, founder (place, éligibilité, refundUntil), partner, subscription } (app)
GET    /api/billing/partner/:code     (20/min) → validation du code POUR l'utilisateur (déjà utilisé, déjà abonné…)
GET    /api/pricing/partner/:code     PUBLIC (20/min, max-age=60) → conditions du code (valid, prix, durée) ou raison du refus ; ni partenaire ni utilisations
GET    /api/admin/partner-codes       ADMIN → codes + used/max, actifs, perdus, rendus, checkouts en cours
POST   /api/admin/partner-codes       ADMIN → création (2 coupons Stripe créés par l'API)
PATCH  /api/admin/partner-codes/:id   ADMIN → modification / activation (sans effet sur les abonnés)
GET    /api/admin/partner-codes/:id/users  ADMIN → abonnés du code
GET    /api/session/today/trades       JWT → trades du jour (du compte de la session active s'il y en a une)
GET    /api/session/today/stats        JWT → stats live (totalPnl, winRate, tradesCount, trades), même périmètre
# 1 session = 1 compte (#457) : un trade n'est rattaché à la session active (création, synchro
# broker, rattachement à la clôture) que s'il est sur SON compte ; la clôture ne compte que ces
# trades. Le débrief et la carte « Publier » lisent les totaux de la session clôturée.
# Et seulement s'il est daté de la journée CME de la session (#994) : un import d'historique ou une
# synchro complète pendant une séance ouverte n'y rattache pas les trades passés.
POST   /api/session/trades/:id/close   JWT → clôturer un trade (exitPrice → détection SL/TP/Manuel)

GET    /api/eco-calendar/today         PREMIUM → events du jour + analyse IA (cache Redis 1h)
POST   /api/eco-calendar/analyze-result PREMIUM → analyse d'un résultat tombé en temps réel ; @Throttle 20/min (S2 #1045)
POST   /api/eco-calendar/refresh-today JWT → vide le cache du jour du trader ; @Throttle 5/min ; résumé du matin mutualisé : au plus 5 générations distinctes par trader et par jour (`eco:morning-gen:<date>:<userId>`, au-delà « Données IA indisponibles ») (S2 #1045)
PATCH  /api/eco-calendar/pins     JWT → `SavePinsDto` (≤ 50 clés « nom:devise » de ≤ 120) ; analyze-result → `AnalyzeResultDto` (eventName ≤ 200) ; analytics : from/to illisibles et mois hors 1-12 = 400 (C11 #1045)
GET    /api/eco-calendar/release-analyses?date=YYYY-MM-DD JWT → analyses déjà produites d'un jour PASSÉ
GET    /api/eco-calendar/range?from&to JWT → vue semaine ; AAAA-MM-JJ, from ≤ to, ≤ 31 jours sinon 400 ; FMP seulement à ±90 j d'aujourd'hui, jour vide marqué 6 h (`eco:range-empty:<date>`) (S1 #1045)
       (EcoReleaseAnalysis, aucun appel IA, donc ouverte à la démo ; vide pour aujourd'hui et après) ;
       renvoyées sous le nom FMP ET sous le libellé affiché (`nameFr`), sans suffixe de période.
       Signature d'actifs de l'utilisateur d'abord, sinon la plus récente. Rendu = `{ interpretation, gap }`
       (#920) ; une ligne à l'ancien format (sentiments par actif) est lue sans ses sentiments, jamais réécrite.
       Écrites au clic ET par la génération automatique (`ensureReleasedAnalysis`, même `assetsSignature`
       dédoublonnée que la clé Redis).

GET    /api/ai/cooldown                PREMIUM → { cooldownSeconds, insights } (dernière analyse réussie gardée 4 h, null sinon) (C4 #1046) ; forme : `InsightsCooldownResponse` (`@mtc/shared`, #1056)
POST   /api/ai/insights                PREMIUM → cooldown 4h par user (posé atomiquement, retiré si l'analyse échoue) ; 0 trade clôturé → 400 « Ajoute au moins un trade clôturé… » (C9 #1046) ; forme : `InsightsResponse` (`@mtc/shared`)
POST   /api/ai/chat                    PREMIUM → 50 messages/jour par user

POST   /api/trades/import              PREMIUM → CSV parsing via Claude SDK
GET    /api/instruments                JWT → futures CME + crypto (InstrumentsController)
GET    /api/instruments/search?q=      JWT → FMP, puis liste statique, puis crypto (10 max)
GET|PATCH /api/instruments/user-assets JWT · PATCH /api/instruments/favorite-asset
GET    /api/market/context             JWT (FREE, IA mutualisée) → DXY, taux, indices (MarketController)
GET    /api/market/news?symbols=       JWT (FREE) · GET /api/market/news/:id/text (traduction paresseuse)
GET    /api/market/live-price?symbol=  JWT (FREE) → trade rapide
  (TradesController ne gère que les trades ; ses anciennes routes market/instruments sont @DeprecatedRoute)

GET    /api/debrief/current            PREMIUM
GET    /api/debrief/:year/:week        PREMIUM
GET    /api/debrief/:year/:week/pdf    PREMIUM → export PDF via puppeteer ; @Throttle 5/min, file par process ≤ 10 rendus (`PDF_QUEUE_MAX`) sinon 503 (S3 #1045)
PATCH  /api/debrief/:debriefId/objectives/:index/note PREMIUM → `ObjectiveNoteDto` (texte ≤ 1000, réinjecté dans le prompt suivant) (C11 #1045)
GET    /api/debrief/history            PREMIUM → 52 dernières semaines en entrées légères `DebriefHistoryItem` (id, semaine, dates, nombre de trades ; ni analyse ni P&L) : sélecteur de semaine de l'écran Débrief (#959)
POST   /api/debrief/generate           PREMIUM → 1/jour par user (rendue si l IA échoue) ; semaine sans trade clôturé → 400 « Aucun trade clôturé cette semaine pour l’instant… » (C8 #1046, #1056)

GET    /api/vps/servers                ADMIN → serveurs du sélecteur Surveillance [{id,label,readOnly}]
GET    /api/vps/stats                  ADMIN → stats système SSH
POST   /api/vps/apt-update             ADMIN → SSE stream
POST   /api/vps/reboot                 ADMIN → confirmation requise
GET    /api/docker/containers          ADMIN
POST   /api/docker/containers/:id/start|stop|restart   ADMIN
DELETE /api/docker/containers/:id      ADMIN
GET    /api/vps/backups                ADMIN
POST   /api/vps/backups                ADMIN → pg_dump via SSH
GET    /api/vps/logs/:container        ADMIN → SSE stream docker logs (nom [a-zA-Z0-9][a-zA-Z0-9_-]*, sinon 400 ; canal SSH fermé à la fermeture de l'onglet)
GET    /api/admin/ai-cost              ADMIN → coût IA 30 j (réel + estimé)
GET    /api/admin/users                ADMIN → liste (?page&limit&search&source&medium&campaign) ┐
GET    /api/admin/users/stats          ADMIN → KPIs (MRR, inscrits, essais) │ AdminUsersController
GET    /api/admin/users/online         ADMIN                                │ (littéraux AVANT :id)
GET    /api/admin/users/subscriptions  ADMIN → abonnements                  │
GET    /api/admin/users/:id            ADMIN → fiche (usage.currency + sessions[].currency, #947) │
PATCH  /api/admin/users/:id            ADMIN → {name?, isInternal?} seulement (rôle/plan → 400, A1/B2 #1064) │
PATCH  /api/admin/users/:id/role       ADMIN · DELETE /api/admin/users/:id (démo → 409, B9) │
POST   /api/admin/users/:id/offer-premium ADMIN → Premium offert {days?} 1-90 │
                                       (défaut 30, prolonge, 409 si Stripe/PREMIUM/rôle/démo) │
DELETE /api/admin/users/:id/offer-premium ADMIN → retire le Premium offert (B10 #1064) │
                                       → {trialEndsAt} (essai d'inscription rendu) ou null ; 409 si Stripe/aucune offre/démo │
POST|DELETE /api/admin/users/:id/beta  ADMIN → rôle bêta-testeur (boutons de la fiche) ┘
GET    /api/admin/ambassadors          ADMIN → liste                        ┐
GET    /api/admin/ambassadors/:id/stats ADMIN                               │ AdminAmbassadorsController
PATCH  /api/admin/ambassadors/:id/pay-all ADMIN                             │
POST   /api/admin/ambassadors/promote|revoke ADMIN                          │
GET    /api/admin/referral/overview    ADMIN                                ┘

GET    /api/integrations/tradovate/connections                 JWT → état de connexion par compte (jamais de token) · `brokerTradesCount` = trades broker ENCORE présents (≠ `tradesImported`, cumul jamais décrémenté)
POST   /api/integrations/tradovate/accounts/:accountId/authorize  JWT → { url } + cookie httpOnly de state · body { origin?: 'wizard'|'settings' }
POST   /api/integrations/tradovate/accounts/:accountId/select     JWT → choix du compte Tradovate { externalAccountId }
POST   /api/integrations/tradovate/accounts/:accountId/sync       JWT → synchro manuelle (FREE, pas de cron en V1)
DELETE /api/integrations/tradovate/accounts/:accountId            JWT → déconnexion (tokens supprimés, trades gardés) · `?deleteTrades=true` → supprime AUSSI les trades BROKER_SYNC/BROKER_HISTORY de ce compte (jamais MANUAL/CSV_IMPORT) → { disconnected, tradesDeleted } ; suppression hors transaction, en échec → connexion quand même coupée, `tradesDeleted: null` + log
GET    /integrations/tradovate/callback   PUBLIC, HORS /api (redirect_uri enregistré) → 1re synchro puis 302 vers l'app

GET    /api/discord/link               JWT → { linked } (jamais l'identifiant Discord)
POST   /api/discord/link-code          JWT, 5 / h par compte, bloqué en démo → { code: 'XXXX-XXXX', expiresAt } (10 min, usage unique)
POST   /api/discord/link               PUBLIC + x-discord-secret (bot) · body { code, discordId } → 200 { linked, plan } | { linked: false, message } (voir security.md, #741)
GET    /api/discord/verify             PUBLIC + secret : ancien /verify email, ne relie plus rien (réponse fixe)

GET    /api/health
POST   /api/test/upgrade-user          NODE_ENV=test uniquement
```
