# VERIF-PRE-PROD — audit non destructif (multi-comptes 104-107, débrief 108, landing 109)

> Audit read-only. Exécuté en local sur la **DB de test locale** (`localhost:6432`, jamais
> la prod — gate de sécurité passé). Stripe non sollicité en LIVE, aucun appel réel
> Anthropic/Resend. Aucune correction de comportement appliquée. Aucun commit.
> Date : audit pré-prod sur branche `dev`.

## VERDICT GLOBAL : ✅ OK pour prod — 0 FAIL bloquant. W1 et W2 corrigés (PROMPT 112).

Le risque n°1 (fuite de données entre utilisateurs via `accountId`) est **propre** :
chaque endpoint valide la propriété côté serveur. Builds, lint et tests unitaires verts.

| # | Sujet | Statut |
|---|-------|--------|
| W1 | Débrief IA : garde `NODE_ENV` (stub hors prod sauf `AI_DEBRIEF_DEV=true`) | ✅ PASS (corrigé 112) |
| W2 | `IS_CRON_WORKER` : crons en opt-in explicite (fail-safe cluster) | ✅ PASS (corrigé 112) |
| W3 | E2E Playwright non exécuté (pas de DB de test isolée, suite existante flaky) | WARN |
| I1 | `register` crée un FREE sans trial (le trial 7j est un parcours séparé) | INFO |
| I2 | Deux migrations au même timestamp `20260613000000` (ordre par nom, OK) | INFO |

> **Action de déploiement requise (W2)** : poser `IS_CRON_WORKER=true` sur **un seul**
> process/instance cron. En prod clusterisé (NODE_ENV=production), `main.ts` désigne déjà
> exactement un worker cron via `cluster.fork({IS_CRON_WORKER:'true'})` → rien à faire pour
> le déploiement single-container actuel. Si la prod passe à **plusieurs conteneurs/replicas
> API**, n'autoriser le cron que sur UNE instance (les autres : variable absente = aucun cron).

---

## PHASE 0 — Build / lint / tests

| Item | Statut | Détail |
|------|--------|--------|
| Build api / app / admin / landing | ✅ PASS | `nx run-many build` → 4 projects OK |
| Lint (4 projets) | ✅ PASS | 0 error (warnings pré-existants : 8 app, 45 api — `no-non-null-assertion`/`any`) |
| Tests api | ✅ PASS | 32 fichiers, **299 tests** |
| Tests admin | ✅ PASS | 6 fichiers, **25 tests** |
| Tests app | ✅ PASS | suite verte |
| Typecheck strict (`tsc --noEmit`) | ✅ PASS (via build) | Les builds AOT/webpack typecheckent ; `prisma migrate status` CLI indisponible (url dans config file), contourné par lecture directe de `_prisma_migrations` |
| E2E Playwright | ⚠️ WARN (W3) | Non lancé : la suite existante tape l'app+API sur la **DB dev** (pas isolée), crée des users réels, et a des specs `analytics-free` connues flaky (`test-output/`). La lancer polluerait la DB dev. Reco : infra E2E isolée (suivi PROMPT 110) avant d'en faire un gate. |

## PHASE 1 — Sécurité multi-tenant ✅ PASS (point le plus critique)

| Contrôle | Statut | Preuve |
|----------|--------|--------|
| Ownership serveur sur `accountId` | ✅ PASS | `accounts.service.ts accountWhere()` : `findUnique(id)` puis `account.userId !== userId → NotFoundException(404)`. Jamais de confiance client. |
| Analytics (10 routes) | ✅ PASS | `analytics.controller.ts:21` toutes via `accountWhere(user.id, accountId)` |
| Trades (filtres + create) | ✅ PASS | `trades.controller.ts:126` filtres via `accountWhere` ; create résout via `accountWhere` puis fallback |
| Sessions (history) | ✅ PASS | `session.controller.ts:75` via `accountWhere` |
| Accounts update/remove | ✅ PASS | `assertOwner(userId, id)` (404 si autre user) |
| Débrief | ✅ PASS | aucun `accountId` client : groupe les comptes du `userId` (`findMany where userId`) |
| Quota serveur | ✅ PASS | create + update(réactivation) → `ACCOUNT_LIMIT_REACHED` (tests `accounts.service.spec`) |
| `@CurrentUser` runtime | ✅ PASS | `jwt.strategy.ts validate()` relit l'user en base → `plan, role, trialEndsAt, isDemo` frais (un downgrade prend effet immédiatement) |
| Test runtime A≠B | ✅ PASS (live) | FREE `POST /accounts` : 1er compte **201**, 2e → **403** `ACCOUNT_LIMIT_REACHED` (quota service, plus de StarterGuard) ; `GET /referral/me` authed → 200 |

## PHASE 2 — Conformité multi-comptes (104-107) ✅ PASS

| Réf | Item | Statut | Preuve |
|-----|------|--------|--------|
| 104 | Capital scopé au compte sélectionné | ✅ | `dashboard.component baseCapital` + `dashboard-capital.spec` (compte→startingBalance ; all→somme non-archivés ; FREE→capital profil) |
| 105 | « Mes comptes » highlight + grille auto-fit + KPIs agrégés | ✅ | `.is-selected` + `accounts-selection.spec` ; grille `auto-fit` (109/105) |
| 106 | Sélecteur global accessible tous plans | ✅ | topbar `showAccountSelector` (plus de gate plan) |
| 106 | Journal/Analytics/Sessions filtrés + trade sur bon compte + anti-fuite | ✅ | `trades.store.spec` (accountId + loadMore), `journal-account.spec` (POST accountId) |
| 107 | Slot = ACTIVE only (create + update) | ✅ | `accounts.service assertActiveSlotAvailable` + `accounts.service.spec` |
| 107 | `remove` garde ≥ 1 actif | ✅ | `remove()` BadRequest si dernier actif (test présent) |

## PHASE 3 — Migrations & intégrité ✅ PASS (1 INFO)

| Item | Statut | Détail |
|------|--------|--------|
| Migrations appliquées, rien de pending | ✅ PASS | `_prisma_migrations` : toutes `finished_at` non nulles |
| Drift | ✅ PASS | 2 lignes `rolled_back` (`add_session_reflection`, `user_is_demo`, juin 6-7) sont d'anciennes tentatives **résolues** (chaque migration réappliquée, count=2) sur la DB dev locale — pas du drift courant ; la prod applique via `migrate deploy` |
| Twin timestamp `20260613000000` | ℹ️ INFO (I2) | `multi_comptes_trading_account` puis `user_subscription_canceled_at` : ordre lexicographique par nom complet (`m`<`u`), déterministe, tables disjointes (pas de conflit). Fragile si renommage → à garder en tête. |
| `accountId` nullable + `onDelete: SetNull` | ✅ PASS | `schema.prisma:146-147` (Trade), `:214-215` (TradeSession) |

## PHASE 4 — Débrief par compte (108) & coût IA ✅ PASS (1 WARN)

| Item | Statut | Détail |
|------|--------|--------|
| Un seul appel IA / génération | ✅ PASS | `debrief.service.spec` « UN SEUL appel IA » avec 2 comptes |
| `max_tokens` borné | ✅ PASS | `debrief.agent.ts:33` `min(4096, 1600 + comptes*500)` |
| `cache_control` ephemeral | ✅ PASS | `debrief.agent.ts:38` |
| **Garde `NODE_ENV` (pas d'appel hors prod)** | ✅ **PASS (corrigé 112)** | `debrief.agent.ts` : si `NODE_ENV !== 'production'` ET `AI_DEBRIEF_DEV !== 'true'` → stub `{overview:{summary:'(débrief IA disponible en production)'}, accounts:[]}`, aucun appel modèle. `AI_DEBRIEF_DEV=true` permet le vrai rendu à la demande en dev. Prod inchangé. Testé (`debrief.agent.spec`). Le stub `accounts:[]` rend les onglets sans crash (sections par compte construites depuis la BDD, texte IA vide). |
| Réponse `{overview, accounts[]}` + rétrocompat | ✅ PASS | service construit la structure ; front `legacyStrengths`/`overviewSummary` fallback (`debrief-tabs.spec`) |
| `propNote` framé estimation (AMF) | ✅ PASS | `debrief.prompt.ts` : « estimation depuis tes trades loggés, pas le calcul officiel », jamais de chiffre officiel ni promesse |
| Front onglets, pas de crash si vide, Premium-only | ✅ PASS | tabs overview + par compte ; gété `isPremium` (paywall) |

## PHASE 5 — Landing (109) gating ✅ PASS

| Item | Statut | Détail |
|------|--------|--------|
| `FEATURES.multiAccounts` / `referral` OFF par défaut | ✅ PASS | `config.ts:19,22` `flag(env)` → false si env absent |
| Flags OFF : home sans sections, pricing sans encart, pages redirigent | ✅ PASS | vérifié build : home sans `#multi-comptes`/`#parrainage`/`price-accts` ; `/ambassadeur` + `/journal-trading-prop-firm` → meta-refresh `/` sans fuite de contenu |
| multiAccounts ON : tout s'affiche, 1 `<h1>`/page, meta + JSON-LD | ✅ PASS | build flag ON : sections présentes, prop-firm 1 H1 + FAQPage JSON-LD, parrain avant filleul |
| `referral` reste OFF (100 non shippé) | ✅ PASS | défaut false, à flipper quand parrainage en prod |
| Aucun em-dash, aucune promesse de gain | ✅ PASS | 0 em-dash dans les 4 fichiers landing ; mentions AMF présentes |

## PHASE 6 — Stripe & argent ✅ PASS

| Item | Statut | Détail |
|------|--------|--------|
| Signature webhook vérifiée | ✅ PASS | `stripe.service.ts:248` `constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET)` ; reject → 400 |
| Montée/descente de plan | ✅ PASS | `stripe-webhook.service.spec` : checkout→PREMIUM, abo actif→PREMIUM, trialing→accès, annuel direct→trialUsed reste false, deleted→FREE+churn daté |
| Aucune clé LIVE en clair | ✅ PASS | 0 `sk_live`/`pk_live` dans le source |
| Premium verrouillé sans plan/trial | ✅ PASS | `premium.guard.ts` (`PREMIUM_REQUIRED`, `trialEndsAt`) |

## PHASE 7 — Onboarding gate (097) ✅ PASS

| Item | Statut | Détail |
|------|--------|--------|
| Session/compagnon accessible FREE | ✅ PASS | `session.controller.ts:25` `@UseGuards(JwtAuthGuard)` seul — pas de StarterGuard, l'entrée n'est pas verrouillée |
| Inscription → arrivée app | ✅ PASS (live) | register → 201, plan FREE, token ; flux onboarding non bloquant côté guards |
| ℹ️ trial 7j | ℹ️ INFO (I1) | `register` crée un **FREE sans trial**. Le trial 7j est un parcours séparé (`start-trial` / checkout Stripe avec trial), pas auto à l'inscription. Conforme au modèle (FREE par défaut), mais à confirmer vs l'attendu « inscription → trial ». |

## PHASE 8 — Hygiène déploiement ⚠️ 1 WARN

| Item | Statut | Détail |
|------|--------|--------|
| Env requis | ✅ INFO | `DATABASE_URL` (local 6432 ok), Stripe/`STRIPE_WEBHOOK_SECRET`, Anthropic, Resend, `PUBLIC_FEATURE_*` (landing). Vérifier leur présence sur chaque env prod/beta avant deploy. |
| Crons / `IS_CRON_WORKER` | ✅ **PASS (corrigé 112)** | `app.module.ts` : `IS_CRON_WORKER === 'true' → ScheduleModule.forRoot()` (opt-in explicite). Par défaut (variable absente ou `false`) → **aucun cron** (fail-safe). `main.ts` fork déjà exactement un worker `'true'` en prod clusterisé. `.env.example` mis à jour. Reste l'action déploiement multi-conteneurs (cf. encadré en tête). |
| Secrets loggués | ✅ PASS | pas de log de clé constaté |

## PHASE 9 — Parcours réel (instance lancée) — PARTIEL ✅ + couverture par tests

Exécuté **live** contre la stack dev (API `:3001`, DB locale), user jetable nettoyé :

| Étape | Action | Résultat réel | Statut |
|-------|--------|---------------|--------|
| 1 Inscription | `POST /auth/register` | 201, plan FREE, JWT émis (pas de trial auto — cf. I1) | ✅ |
| — Auth | `GET /referral/me` (authed) | 200 | ✅ |
| 6 Quota/anti-bypass | FREE `POST /accounts` 2e compte | **403** `ACCOUNT_LIMIT_REACHED` (quota service) | ✅ |
| 10 Nettoyage | `DELETE User` test | 0 ligne restante | ✅ |

Étapes 2-5, 7-9 (onboarding UI, multi-comptes 3 comptes, trade sur compte sélectionné,
slot ACTIVE-only, débrief onglets, Stripe up/down) : **logique couverte par les tests**
(`accounts.service.spec` quota+slot, `dashboard-capital.spec`, `journal-account.spec`,
`debrief-tabs.spec`/`debrief.service.spec`, `stripe-webhook.service.spec`). Le parcours
**UI navigateur complet** exige la stack de test lancée avec users FREE/PREMIUM seedés
(non disponible ici sans DB de test isolée) → couvert au niveau logique, à rejouer en UI
via l'infra E2E (W3) + la checklist `docs/ops/SMOKE-PROD.md` post-déploiement.

---

## Suivi

1. ~~**W1 — Garde `NODE_ENV` sur le débrief**~~ → **corrigé (PROMPT 112)** : stub hors prod
   sauf `AI_DEBRIEF_DEV=true`.
2. ~~**W2 — `IS_CRON_WORKER`**~~ → **corrigé (PROMPT 112)** : opt-in explicite. Action deploy :
   `IS_CRON_WORKER=true` sur un seul process cron (cf. encadré en tête).
3. **W3 — E2E isolée** : prioriser l'infra Playwright (DB test + seed + storageState) avant
   d'en faire un gate CI. → suivi.
4. **I1 — trial à l'inscription** : confirmer que « register = FREE sans trial » est bien
   l'attendu (vs un trial 7j auto).

Aucun FAIL bloquant : **OK pour déployer** sous réserve de l'action déploiement W2
(`IS_CRON_WORKER=true` sur un seul process cron en topologie multi-conteneurs) et de la
checklist `docs/ops/SMOKE-PROD.md` passée juste après le deploy.

## Rappel post-déploiement
Après merge, vérifier en prod que le **recap 17h30 ne part qu'UNE fois** (un seul process
avec `IS_CRON_WORKER=true`).
