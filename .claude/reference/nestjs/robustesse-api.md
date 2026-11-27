# Robustesse de l'API

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Robustesse de l'API (audit du 27/09/2026) · 2026-09-27 -->
> **Origine** : `nestjs.md` · « Robustesse de l'API (audit du 27/09/2026) » · 2026-09-27

## Robustesse de l'API (audit du 27/09/2026)

- **Erreurs** : `HttpExceptionFilter` est global (`@Catch()`), toute erreur sort au format
  `{ statusCode, code?, message, timestamp, path }`. Prisma non rattrapé : P2002 → 409
  `CONFLICT`, P2025 → 404 `NOT_FOUND` ; le reste → 500 `INTERNAL` sans détail (pile dans les
  logs + Sentry). `path` et les logs n'incluent jamais la query string.
- **Sentry** : `src/instrument.ts`, premier import de `main.ts`, actif seulement si `SENTRY_DSN`.
  Options dans `common/sentry/sentry-options.ts` (#746). `sendDefaultPii: false` ne suffit PAS
  (SDK 10.x) : il retire l'IP mais joint le corps (10 ko), les cookies, tous les en-têtes et la
  query string. D'où `httpIntegration({ maxIncomingRequestBodySize: 'none' })`, `beforeSend`
  (`scrubEvent` : retire `request.data`, `cookies`, `query_string`, en-têtes `authorization` /
  `cookie`, coupe l'URL au `?`) et `beforeBreadcrumb` (`scrubBreadcrumb` : retire `http.query`
  des appels sortants, où passent les `apikey=` FMP / calendrier). Ne jamais utiliser l'option
  `dataCollection` : posée, elle repart de « tout collecter », IP comprise. Gardés : erreur,
  méthode, chemin, en-têtes techniques, `user.id`, tags. Dans un `captureMessage` / `extra` :
  nom et code de l'erreur, **jamais son message** (texte libre : adresse, hôte, port…).
  **Jamais l'identifiant client Stripe** (#827) : pour situer un compte, `user: { id }` interne.
  Filet : `scrubEvent` et `scrubBreadcrumb` remplacent tout `cus_…` (message, exceptions, URL des
  appels sortants vers `/v1/customers/…`) par `cus_[masqué]`. L'identifiant d'abonnement (`sub_…`)
  reste dans le message `Subscription past_due/unpaid`.
  **Jamais d'adresse e-mail** (#1263) : `captureException` envoie le message complet de l'erreur
  (Resend, Prisma, Stripe peuvent y recopier une adresse). Filet : `maskText` (même fichier)
  remplace toute adresse par `[e-mail masqué]` dans `message`, `logentry.message`, les exceptions,
  leurs frames (lignes de code de ContextLines, variables locales) et le message des breadcrumbs, en plus du `cus_…`. Motif volontairement large (faux positif accepté).
  Vérification sur un vrai événement : `docs/ops/verif-sentry-donnees-requete.md`.
  Les 5xx sont remontées par le filtre global ; ne pas ajouter de `captureException` ailleurs.
- **IA** : modèles dans `AI_MODELS` (`modules/infra/ai-pricing.const.ts`), jamais en dur ni en
  alias local (`AI_MODELS.analysis` = `claude-sonnet-4-6`, `AI_MODELS.fast` = `claude-haiku-5-5`) ;
  un test vérifie que chaque modèle a son tarif. Délai par appel = `max(60 s, 30 ms × max_tokens)`,
  une seule relance, chaque échec tracé (sans le contenu envoyé).
  - **Réflexion coupée par défaut** : Haiku 5.5 réfléchit si `thinking` est absent, ce qui mange
    `max_tokens` et se facture. `AnthropicClientService.create` applique `AI_THINKING_OFF` quand
    l'appel ne précise pas `thinking` : Haiku 5.5 → `disabled`. Un modèle absent de la table
    (Sonnet 4.6) part **sans** champ `thinking`, comme avant (testé). Pour activer la réflexion sur
    un appel, passer `thinking` explicitement.
  - **Lire la réponse avec `responseText(response)`**, jamais `content[0]` : un bloc `thinking`
    peut venir en premier, et un refus (`stop_reason: 'refusal'`, nouveau sur les 5.5, tracé en
    warn) peut revenir sans contenu. Haiku 5.5 n'a pas de repli serveur (`fallbacks` interdit).
  - **Paramètres refusés par Haiku 5.5** (400) : `temperature` / `top_p` / `top_k` non par défaut,
    `budget_tokens`, préremplissage d'un tour assistant final. Aucun n'est utilisé.
  - **Effort** : non envoyé (défaut `medium` sur Haiku 5.5, sans effet tant que la réflexion est
    coupée).
  - **Sonnet 5.5 : à retenter plus tard** (testé le 2026-10-08, pas adopté). Chat coupé à
    `max_tokens: 512` (~420-500 tokens contre ~160-220 en Sonnet 4.6, l'effort ne raccourcit pas),
    débrief JSON illisible 1 fois sur 8. Il refuse aussi `thinking: disabled` (400) : y couper la
    réflexion avec `between_tools`, sans autre champ, effort `high` au plus. Détail dans `plans.md`.
- **Santé** : `GET /api/health` = liveness (process vivant, healthcheck Docker) ;
  `GET /api/health/ready` = readiness (ping Postgres + Redis, 503 en nommant le composant).
  `/health` jamais limitée en débit, `/health/ready` à 600 / min / IP (voir `security.md`).
- **Environnement** : `src/config/env.ts` est la liste de référence (required / production /
  optional + format). Nouvelle variable → l'y ajouter ET dans `apps/api-mytradingcoach/.env.example`.
  En local, la valeur va dans le `.env` racine (commun) : `.env.development` / `.env.local` ne
  portent que DATABASE_*, REDIS_* et NODE_ENV (`envFilePath: [<contexte>, '.env']`, le premier gagne).
- **Redis** : `RedisService` se connecte à l'init (`onModuleInit`) ; sans ça, la 1re commande de
  chaque worker échouait (`lazyConnect` + `enableOfflineQueue: false`).
