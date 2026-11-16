# Isolation Redis entre environnements

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Isolation Redis entre environnements (SCA-B0-01, 2026-09-30) · 2026-09-30 -->
> **Origine** : `deploy.md` · « Isolation Redis entre environnements (SCA-B0-01, 2026-09-30) » · 2026-09-30

## Isolation Redis entre environnements (SCA-B0-01, 2026-09-30)

⚠️ **`REDIS_URL` n'est lu par AUCUN code.** Seuls `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`,
`REDIS_DB` et `REDIS_PREFIX` comptent (`modules/infra/redis-config.ts`). Constaté le 30/09 : le
`/1` du `REDIS_URL` de dev était ignoré, donc **dev et prod partageaient la base 0 de `mtc_redis`**
et le worker dev pouvait consommer les jobs `stripe` / `debrief` de la prod.

| Variable | Défaut | Effet |
|---|---|---|
| `REDIS_DB` | `0` | base Redis de toutes les connexions (cache, throttler, BullMQ, socket.io) |
| `REDIS_PREFIX` | vide | préfixe des clés (`keyPrefix`), des files (`<prefix>bull`) et du canal socket.io |

Le canal socket.io porte aussi la base (`socket.io:db1`) : le pub/sub Redis ignore le numéro de
base, sans ça deux environnements sur deux bases se diffuseraient leurs événements.

| Env | Serveur | `REDIS_DB` | `REDIS_PREFIX` |
|---|---|---|---|
| prod | `mtc_redis` | *(absent → 0)* | *(absent)* : **ne pas en ajouter**, les clés et jobs existants seraient orphelins |
| dev | `mtc_redis` | `1` | `dev:` |
| beta | `mtc_redis_beta` (serveur à part) | *(absent → 0)* | *(absent)* ; supprimer le `REDIS_URL` périmé de `.env.beta` (pointe sur `mtc_redis`) |

**Ordre de remise en route de dev** (arrêté le 30/09 à cause du partage) : déployer le code
contenant SCA-B0-01 sur dev, ajouter `REDIS_DB=1` et `REDIS_PREFIX=dev:` à `.env.dev`, **puis
seulement** relancer `mtc_api_dev`. Un push sur `dev` avant ça relance le conteneur sur la base
partagée.

Plus aucun `KEYS` dans le code : `RedisService.scanKeys()` (SCAN par lots, préfixe géré). Les
échecs de jobs BullMQ sont gardés 7 jours / 1 000 au plus (`removeOnFail`), Redis étant en
`noeviction`.
