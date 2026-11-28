# Variables d'environnement requises

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Variables d'environnement requises (.env.production) · 2026-04-25 -->
> **Origine** : `deploy.md` · « Variables d'environnement requises (.env.production) » · 2026-04-25

## Variables d'environnement requises (.env.production)

```bash
NODE_ENV=production

# DB — DATABASE_URL pointe vers PgBouncer, DIRECT vers Postgres (migrations)
DATABASE_URL=postgresql://mtc_user:PASSWORD@mtc_pgbouncer:6432/mytradingcoach_prod?pgbouncer=true&connection_limit=1
DATABASE_DIRECT_URL=postgresql://mtc_user:PASSWORD@mtc_postgres:5432/mytradingcoach_prod

REDIS_HOST=mtc_redis
REDIS_PORT=6379
REDIS_PASSWORD=...
# REDIS_DB / REDIS_PREFIX : voir « Isolation Redis » ci-dessous. Prod : ni l'un ni l'autre.

JWT_SECRET=...           # 64 chars minimum
JWT_REFRESH_SECRET=...   # 64 chars minimum
ANTHROPIC_API_KEY=sk-ant-...
AI_MAX_CONCURRENCY=4     # optionnel : appels modèle simultanés, tous process confondus (SCA-B5-06)
# NEWS_SHIELD_ENABLED=true  # bouclier annonces (#670), lu par les process web qui tiennent les WebSocket Tradovate
#                           # (minuteur du gateway) : absente = coupé. Dev : allumé au merge ; prod : posé par Greg
#                           # après vérification sur dev. Changer la valeur = recréer api_blue/api_green (env_file).
# SESSION_CONTRACT_ENABLED=true  # contrat de session (#667), lu par les process web (routes /session/contract*, et BehaviorAlertsService appelé par le gateway Tradovate) : absente ou autre que 'true' = coupé, routes en 404. Allumée par Greg (dev puis prod) après le ticket d'interface. Changer la valeur = recréer api_blue/api_green (env_file), `docker restart` ne relit pas l'env.
# HELP_CHAT_ENABLED=true  # chatbot de support (#493), lu par les process web : absente ou autre que 'true' = coupé, routes /help/* et /public/help/* en 404. Allumée par Greg après le widget (étape 3) et le texte de confidentialité. HELP_CHAT_DAILY_LLM_MAX (défaut 500) : plafond d'appels IA par jour ; HELP_KB_MATCH_MIN (défaut 2) : score minimal de la recherche locale. Changer la valeur = recréer api_blue/api_green (env_file).
# INACTIVITY_PURGE_ENABLED=true  # purge des comptes inactifs (#824), lue par le WORKER CRON. Absente/false = journal
#                                # seul (rien envoyé ni supprimé). Allumée par Greg seulement après la PR politique §3 + CGU
#                                # déployée et la lecture du journal « Comptes inactifs (journal seul) » en prod.
#                                # Allumer ou couper = recréer le worker (`up -d --no-deps --force-recreate worker`
#                                # avec docker-compose.prod.yml) : `docker restart` ne relit pas l'env_file.
# RESEND_DRY_RUN=true    # beta/dev, le temps d'un test de charge : aucun e-mail envoyé (ignoré en prod)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PREMIUM_PRICE_MONTHLY_V2=price_...      # Premium 49 €/mois
STRIPE_PREMIUM_PRICE_YEARLY_V2=price_...       # Premium 490 €/an
STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER=price_... # offre fondateur 29 €/mois (#525), REQUISE au boot
STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER=price_...  # offre fondateur 290 €/an (#525), REQUISE au boot
# ⚠️ Les deux prix fondateur sont `required` (config/env.ts) : à poser dans .env.dev / .env.prod
# AVANT de déployer le code qui les lit, sinon l'API refuse de démarrer.
STRIPE_PUBLIC_KEY=pk_live_...                  # page de paiement de l'app (pk_test_ en dev/beta)
# Absente → l'API retombe sur la page Stripe hébergée (avertissement au boot en prod).
# Apple Pay sur la page de l'app : vérifier le domaine app.mytradingcoach.app dans Stripe
# (Paramètres → Moyens de paiement → Domaines). Link et Klarna doivent être activés dans Stripe.
# Webhooks Stripe (version 2026-03-25.dahlia, état relevé le 2026-10-28) :
#   prod  → compte live, destination api_prod (https://api.mytradingcoach.app/api/billing/webhook)
#   dev   → compte de test, we_1UOOBL3gvVCzVhyJP7gXcDZ4 (https://dev.api…) → STRIPE_WEBHOOK_SECRET de .env.dev
#   beta  → compte de test, we_1UOOBM3gvVCzVhyJNT0ODsMl (https://beta.api…) → STRIPE_WEBHOOK_SECRET de .env.beta
#   Événements : charge.refunded, checkout.session.completed, checkout.session.expired, customer.deleted,
#   customer.subscription.created/deleted/paused/updated, invoice.payment_failed, invoice.payment_succeeded,
#   invoice.upcoming (live depuis toujours, dev et beta depuis le 28/10), invoice.payment_action_required
#   (#769, B1 : 3D Secure ; dev et beta depuis le 28/10 ; live à ajouter APRÈS le déploiement de la PR B
#   en prod, jamais avant). Live : 11 événements au 28/10, dev et beta : 12.
#   Récupération des paiements (live, relevé le 28/10) : Smart Retries 8 fois en 2 semaines, puis
#   abonnement ANNULÉ ; paiement à confirmer (3D Secure) non finalisé sous 15 jours : abonnement annulé.
#   « Marquer comme impayé » est aussi géré (place fondateur réservée rendue au statut unpaid).
#   E-mails clients de Stripe Billing (dont le lien de confirmation 3D Secure) : tous DÉSACTIVÉS en
#   live au 28/10, à laisser ainsi : l'API envoie les siens (#769). Moyens de paiement live : carte,
#   Apple Pay, Google Pay, Link, Revolut Pay, Klarna. Réservation fondateur reportée testée en local
#   avec Klarna (28/10) : abonnement en essai, facture à 0 €, place prise ; Link ouvre une fenêtre
#   séparée (non testé de bout en bout).
#   Nouveau type traité par l'API → l'ajouter aux TROIS destinations, sinon il n'arrive jamais.
# Domaines des moyens de paiement : app.mytradingcoach.app (live), dev.app et beta.app (test).
RESEND_API_KEY=re_...
MAIL_FROM=noreply@mytradingcoach.app
ONBOARDING_SEQUENCE_START=2026-11-0XT00:00:00+01:00  # suite d'onboarding : seuls les inscrits APRÈS
# cette date reçoivent les nouveaux e-mails. Absente → la suite ne part pas (warn du cron). À poser
# en prod au déploiement de la suite, à la date de mise en prod (cf. nestjs.md).
FRONTEND_URL=https://app.mytradingcoach.app
# Adresse publique de CETTE API, origine seule SANS /api (le code ajoute /api/emails/unsubscribe) :
# lien de désinscription des e-mails de campagne (#861). Prod : https://api.mytradingcoach.app ;
# beta : https://beta.api.mytradingcoach.app (.env.beta) ; dev : https://dev.api.mytradingcoach.app
# (.env.dev). Absente : repli sur l'API de prod seulement si FRONTEND_URL est l'app de prod ;
# ailleurs, chaque e-mail de campagne est refusé et journalisé (jamais de lien vers la prod).
# Avertissement au démarrage si absente (config/env.ts).
API_URL=https://api.mytradingcoach.app
CORS_ORIGINS=https://app.mytradingcoach.app,https://mytradingcoach.app
PORT=3000
```

### Tradovate / NinjaTrader (PROMPT-207) — optionnelles, feature désactivée sans elles

```bash
TRADOVATE_OAUTH_CLIENT_ID=...        # inscription OAuth MTC (≠ TRADOVATE_API_CID perso)
TRADOVATE_OAUTH_CLIENT_SECRET=...
TRADOVATE_OAUTH_REDIRECT_URI=https://api.mytradingcoach.app/integrations/tradovate/callback
BROKER_TOKEN_ENCRYPTION_KEY=...      # openssl rand -base64 32 — UNE par env, jamais réutilisée
```

- Pendant le développement, l'inscription OAuth côté Tradovate pointe sur **beta**
  (`https://beta.api.mytradingcoach.app/integrations/tradovate/callback`) : `.env.beta` porte
  cette URI. Repasser l'inscription ET `.env.production` sur l'URL prod uniquement au ship.
- **Temps réel (PROMPT-210 live)** : aucune variable en plus. Le canal `/tradovate-live` passe
  par socket.io sur l'hôte `api.` (comme `/eco`, déjà routé par Traefik) ; l'API ouvre en
  sortie des WebSockets Tradovate, hôte tiré de `apiHosts` (hôte demo propre à chaque prop firm,
  cf. nestjs.md). Redis requis pour le bail « un WebSocket
  Tradovate par user » entre workers (sans Redis : au pire un par worker). Nouveau cron
  `TradovateBackgroundRefreshCron` (toutes les 30 min, worker cron uniquement).
- Le callback est servi **hors `/api`** : Traefik route tout l'hôte `api.` vers le conteneur,
  rien à ajouter. Vérif post-deploy : `curl -sI https://<api>/integrations/tradovate/callback`
  → `302` vers `<FRONTEND_URL>/accounts?tradovate=error&reason=session_expired` (normal sans cookie).
- Changer `BROKER_TOKEN_ENCRYPTION_KEY` rend toutes les connexions illisibles : les users
  devront se reconnecter (aucun trade perdu).
