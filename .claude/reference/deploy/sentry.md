# Sentry

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Sentry (SCA-B0-09, 2026-09-30) · 2026-09-30 -->
> **Origine** : `deploy.md` · « Sentry (SCA-B0-09, 2026-09-30) » · 2026-09-30

## Sentry (SCA-B0-09, 2026-09-30)

- Actif dès que `SENTRY_DSN` est défini (`src/instrument.ts`) : `sampleRate 1`, `tracesSampleRate 0`
  (aucun surcoût), `sendDefaultPii false`, `environment` = `SENTRY_ENVIRONMENT` ou `NODE_ENV`,
  `release` = SHA court du commit (le CD exporte `GIT_SHA`, le compose le passe en `SENTRY_RELEASE`).
- **Où mettre le DSN** : créer un projet Node.js sur sentry.io (offre gratuite), copier le DSN dans
  `/opt/apps/mytradingcoach/prod/.env.production` (`SENTRY_DSN=…`), puis recréer le conteneur.
  `SENTRY_ENVIRONMENT=production` est posé en clair dans `docker-compose.prod.yml` (le bloc
  `environment` du compose l'emporte sur l'`env_file`) : l'étiquette ne dépend plus de `NODE_ENV`.
- **Dev et beta ne sont pas branchés sur Sentry (décision du 2026-10-16).** Si un jour on les branche,
  poser `SENTRY_ENVIRONMENT=dev` / `beta` en même temps que le DSN (sinon repli sur `NODE_ENV`, donc
  risque d'étiquette `production`) et ajouter `SENTRY_RELEASE: ${GIT_SHA:-}` à leur compose.
- Au 30/09, **aucun** des trois `.env` n'a de DSN : l'API prod l'affiche désormais en avertissement
  au démarrage.
