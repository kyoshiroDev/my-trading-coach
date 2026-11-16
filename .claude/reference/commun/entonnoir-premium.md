# Entonnoir Premium

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Entonnoir Premium (2026-10-07) · 2026-10-07 -->
> **Origine** : `nestjs.md` · « Entonnoir Premium (2026-10-07) » · 2026-10-07

## Entonnoir Premium (2026-10-07)

`modules/product-events/` : `POST /api/events` (JWT, `@DemoAllowed`, 60/min) → `ProductEventsService.record`
→ `ProductEventDaily` (jour Paris × user × événement × écran, `INSERT … ON CONFLICT` +1, best-effort).
Événements : `premium_seen`, `plan_modal_open`, `trial_click`, `checkout_return` (place `success` /
`canceled`), `demo_open` (enregistré par `AuthService.demoLogin`, **sauf** `{ internal: true }` dans le
corps de `POST /auth/demo-login`, `DemoLoginDto`, #1029), bandeau de la démo (#1029) : `demo_cta_view`,
`demo_cta_click` (place ramené par `productEventPlace` à `DEMO_CTA_PLACEMENTS` = `banner|pill|modal|action`,
sinon `''`), `demo_modal_shown` ; `demo_signup_click` (ancien bouton, plus émis, gardé 13 mois et compté
avec `demo_cta_click`). `DEMO_EVENTS` = les 5 de la démo.
`AdminService.getFunnel(30, includeTests)` : étapes en users DISTINCTS hors démo et ADMIN, démo en occurrences
(`demo` : `opens`, `signupClicks`, `ctaViews`, `modalShown`, `clicksByPlacement`),
détail par écran, état Stripe actuel. But : savoir où le Premium donne envie, avant de toucher à la durée
de l'essai (0 essai en prod au 2026-10-07, décision : garder 30 jours ; remplacée le 2026-10-25 : 14 jours de
Premium offerts à l'inscription sans carte, essai Stripe 30 j seulement pour les comptes antérieurs jamais essayés, Q1 du 2026-11-14).
Installation de l'app (2026-10-25) : 8 événements de plus (`INSTALL_EVENTS` : `install_shown`,
`install_click`, `install_done`, `install_later`, `install_never`, `inapp_seen`, `push_enabled`,
`push_denied`), `place` = plateforme (`INSTALL_PLACES` : `android`, `ios`, `ios-other`, `desktop`).
`getFunnel` renvoie `install` (users distincts par événement × plateforme, plateforme brute : `ios-other`
jamais regroupé avec `ios`), tableau « Installation de l'app » de `/acquisition`. Conservation : 13 mois,
purge QUOTIDIENNE (`DAILY_RETENTION_RULES` de `RetentionCron`, 4 h 45 Paris), cascade à la suppression
du compte. Journal d'échec : nom de l'erreur seulement (jamais `err.message`, qui contient le `userId`).

<!-- Origine : angular.md · Entonnoir Premium (2026-10-07) · 2026-10-07 -->
> **Origine** : `angular.md` · « Entonnoir Premium (2026-10-07) » · 2026-10-07

## Entonnoir Premium (2026-10-07)

`core/services/product-events.service.ts` : `track(event, place?)` / `once(...)` (une fois par écran et par
onglet), place = 1er segment de la route, envoi best-effort. Branché sur : `mtc-premium-lock` (`premium_seen`),
`mtc-plan-modal` (`plan_modal_open` à l'ouverture, `trial_click` sur « Essayer »), `App` (retour Stripe
`?checkout=success|canceled` → `checkout_return`), bandeau d'inscription de la démo (`demo_cta_*`, voir
« Démo : bandeau d'inscription » ci-dessous). Nouveau
teaser Premium → `once('premium_seen')`. Admin : bloc « Entonnoir Premium » de `/acquisition`
(`features/acquisition/funnel.util.ts`, testé).
