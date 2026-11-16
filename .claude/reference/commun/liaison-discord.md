# Liaison Discord (#741)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/security.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Liaison Discord (#741, 2026-10-25) · 2026-10-25 -->
> **Origine** : `angular.md` · « Liaison Discord (#741, 2026-10-25) » · 2026-10-25

## Liaison Discord (#741, 2026-10-25)

Bloc « Discord » de Profil → Paramètres (masqué en démo), directement dans `profile.component`
(les styles `.settings-*` sont propres au composant). `DiscordApi` (`core/api/discord.api.ts`,
`SILENT_ERRORS`) : `status()` lu à l'ouverture (la liaison se fait dans Discord, hors de l'app, donc
pas via `/users/me`), `createCode()` → code affiché + « Copier » (copie `/verify code:XXXX-XXXX`).
Lien direct utilisé par le bot : `/profil?tab=params`. Commande en `white-space: nowrap`.

<!-- Origine : security.md · Liaison Discord par code à usage unique (#741, 2026-10-25) · 2026-10-25 -->
> **Origine** : `security.md` · « Liaison Discord par code à usage unique (#741, 2026-10-25) » · 2026-10-25

## Liaison Discord par code à usage unique (#741, 2026-10-25)

Avant : `/verify email:` reliait au Discord de l'appelant le compte dont on tapait l'e-mail, sans
preuve (le secret du bot prouve seulement que l'appel vient du bot). Désormais :
- `POST /discord/link-code` (connecté, `@Throttle` 5 / h par compte, bloqué en démo) → code de 8 signes
  Crockford (2^40), 10 min, stocké HACHÉ (sha256) dans Redis, un nouveau code efface le précédent.
- `POST /discord/link` (`@Public`, secret du bot comparé en temps constant) : `GETDEL` du code (usage
  unique même en concurrence) ; 5 essais / min et 20 / h par identifiant Discord (`SET NX EX` + `INCR`
  en MULTI, le compteur naît avec son expiration) ; code inconnu, expiré ou déjà utilisé = MÊME réponse.
  Réponse : `{ linked, plan }`, jamais de nom ni d'e-mail.
- `GET /discord/verify` (ancien bot) ne lit plus la base et répond pareil quelle que soit l'adresse.
- Détachements : l'ancien Discord du compte perd ses rôles ; un Discord relié à un autre compte en est
  détaché (`updateMany` dans la même transaction, plus d'erreur d'unicité) ; rôles retirés à la
  suppression du compte (`DiscordGuildClient`, module feuille importé par `UsersModule`).
Verrouillé par `discord-link.service.spec.ts` (7 mutations détectées) et `discord.controller.spec.ts`
(échoue sur l'ancien contrôleur : `verified: true` sur un e-mail tapé par un tiers).
- Délier (`DELETE /discord/link`, connecté, `@Throttle` 5 / h par compte, bloqué en démo) : rôles
  Membre et Premium retirés d'abord par `DiscordGuildClient.tryRemovePlanRoles`, qui, lui, rend `false`
  au moindre échec (réseau, délai, HTTP en erreur, env absente ; 404 = membre parti = réussi). Échec →
  503 avec message clair et liaison GARDÉE (effacée seule, elle laisserait un rôle que plus rien ne
  retire). Puis `updateMany` conditionné à l'identifiant lu (un Discord relié entre-temps reste).
  Journaux : nom de l'erreur ou statut HTTP seulement, jamais l'identifiant Discord, l'URL ni le code.
- Exception unique à « jamais l'identifiant Discord » (N2 #1046) : à la SUPPRESSION du compte, si le
  retrait des rôles échoue (`removePlanRoles` → `false`), un `warn` donne le discordId pour retirer les
  rôles à la main. Le compte n'existe plus : rien ne retentera, l'identifiant est le seul moyen.
- `setPlanRole` lève sur une réponse en erreur (hors 404) ou une panne réseau ; `removePlanRoles` et
  `tryRemovePlanRoles` reposent sur le même appel (`call`), le premier ne lève jamais (booléen).
- Le bouton « Copier » du Profil copie le code seul (plus la commande `/verify code:`).
