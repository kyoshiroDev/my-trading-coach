# Durcissements de sécurité (SCA)

> Contenu déplacé à l'identique depuis `.claude/agents/security.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : security.md · Hash des mots de passe — argon2 OWASP (SCA-B0-03, 2026-09-30) · 2026-09-30 -->
> **Origine** : `security.md` · « Hash des mots de passe — argon2 OWASP (SCA-B0-03, 2026-09-30) » · 2026-09-30

## Hash des mots de passe — argon2 OWASP (SCA-B0-03, 2026-09-30)

- **Toujours** `hashPassword()` de `modules/auth/password-hashing.ts`, jamais `argon2.hash()` nu :
  paramètres `ARGON2_OPTIONS` = argon2id, `memoryCost 19456` (19 Mio), `timeCost 2`,
  `parallelism 1`, le minimum OWASP. Les défauts de la lib (64 Mio, 4 threads) faisaient tomber
  le conteneur API à l'OOM dès quelques inscriptions simultanées.
- Les anciens hashs restent vérifiables ; `login` les remplace via `needsPasswordRehash()`, dans
  la même écriture que `lastLoginAt` (pas de requête supplémentaire).

<!-- Origine : security.md · Rate limiting par IP seule sur l'auth (SCA-B0-04, 2026-09-30) · 2026-09-30 -->
> **Origine** : `security.md` · « Rate limiting par IP seule sur l'auth (SCA-B0-04, 2026-09-30) » · 2026-09-30

## Rate limiting par IP seule sur l'auth (SCA-B0-04, 2026-09-30)

La clé « IP + empreinte d'e-mail » (`EmailAwareThrottlerGuard`) se contourne en changeant
d'e-mail à chaque requête. Un second throttler nommé **`ip`** compte par IP seule :

| Route | IP + e-mail (`default`) | IP seule (`ip`) |
|---|---|---|
| `POST /auth/register` | 5 / min | **10 / h** |
| `POST /auth/login` | 10 / min | **30 / 10 min** |
| `POST /auth/forgot-password` | 3 / min | **10 / h** |

Le throttler `ip` est **neutre par défaut** (`IP_THROTTLER_OFF`, jamais compté, aucun aller-retour
Redis) : il ne s'active que via `@Throttle({ ip: { ttl, limit } })`. Verrouillé par
`register-ip-throttle.int-spec.ts` (11 e-mails distincts depuis une IP → la 11ᵉ reçoit 429).

**`POST /auth/refresh` garde exprès la limite par défaut** (#1132) : 60 / min / IP (requête anonyme,
`@Public`, compteur propre à la route). Pas de limite dédiée : ni e-mail ni IA, pas de force brute
possible (JWT signé par `JWT_REFRESH_SECRET`, jeton invalide rejeté avant toute lecture), rejeu déjà
coupé par la rotation suivie (#1002). **Ne pas la resserrer** : un 429 sur le refresh déconnecte
l'utilisateur côté front (`jwt-refresh.interceptor.ts`, tant que #1145 n'est pas traité), donc une
limite serrée par IP déconnecterait les traders derrière une même IP. Après #1145, cette raison tombe
mais les autres restent : rien de plus à protéger. Verrouillé par `modules/auth/refresh-throttle.spec.ts` : métadonnées
lues sur la méthode puis la classe (comme le guard), débit `default` et `ip` absent ou ≥
`ANON_THROTTLE_LIMIT` par minute (limite rapportée à la fenêtre), route jamais exclue.

<!-- Origine : security.md · Clé de test de charge `LOAD_TEST_KEY` (SCA-B9, 2026-10-01) · 2026-10-01 -->
> **Origine** : `security.md` · « Clé de test de charge `LOAD_TEST_KEY` (SCA-B9, 2026-10-01) » · 2026-10-01

## Clé de test de charge `LOAD_TEST_KEY` (SCA-B9, 2026-10-01)

`common/throttler/load-test-tracker.ts` : avec la clé (≥ 32 car., comparée en temps constant),
le throttler compte par `x-load-client` (borné `[a-z0-9-]{1,64}`) au lieu de l'IP. Ne lève
**aucune** limite (elles s'appliquent par client) mais permet à qui détient la clé de répartir
ses requêtes sur des compteurs arbitraires : **jamais en prod** (désactivée par le code si la base
est `mytradingcoach_prod`), et retirée de `.env.beta` après chaque test.

<!-- Origine : security.md · Cache de l'utilisateur authentifié (SCA-B3-01, 2026-10-03) · 2026-10-03 -->
> **Origine** : `security.md` · « Cache de l'utilisateur authentifié (SCA-B3-01, 2026-10-03) » · 2026-10-03

## Cache de l'utilisateur authentifié (SCA-B3-01, 2026-10-03)

`JwtStrategy.validate` lit l'utilisateur via `AuthUserCacheService` (modules/infra, global) :
Redis 60 s, clé **versionnée** `authuser:<id>:<version>` (la version `authuser:v:<id>` est
incrémentée par `invalidate`, ce qui ferme la course lecture-avant / écriture-après). Redis en panne
→ lecture en base.
**Règle : après TOUTE écriture d'un champ relu par le JWT (plan, rôle, essai, `isDemo`, nom,
e-mail, suppression), appeler `userCache.invalidate(id)`.** Déjà fait dans `users.service`
(admin, rôle, essai, Premium, `updateMe`, suppression), `stripe-subscription.service` (sync de
l'abonnement), `stripe-webhook.service` (résiliation, client supprimé), `ambassador.service`.
Un oubli = jusqu'à 60 s de plan / rôle périmé (ex. Premium payé mais refusé). Les tests qui
modifient ces champs directement en base doivent aussi invalider. Verrouillé par
`auth-user-cache.int-spec.ts` (plan changé → effet immédiat, compte supprimé → 401 immédiat).
