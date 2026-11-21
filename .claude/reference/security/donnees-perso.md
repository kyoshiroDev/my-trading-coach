# Données personnelles, politique de confidentialité, Stripe

> Contenu déplacé à l'identique depuis `.claude/agents/security.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : security.md · Push et autopsie déclarés dans la politique de confidentialité (2026-10-25) · 2026-10-25 -->
> **Origine** : `security.md` · « Push et autopsie déclarés dans la politique de confidentialité (2026-10-25) » · 2026-10-25

## Push et autopsie déclarés dans la politique de confidentialité (2026-10-25)

La page `politique-confidentialite.astro` déclare, alignée sur le code :
- **Push des traders (#666)** : 1.g (champs de `UserPushDevice` : endpoint, `p256dh`/`auth`, `userAgent`
  d'où le libellé est déduit, `createdAt`, `lastSuccessAt` ; 10 appareils max ; `TraderPushPreference`),
  base légale consentement, destinataire « service de notification de l'éditeur du navigateur »
  (liste blanche `push-endpoint.ts` : Google FCM, Mozilla, Apple, Microsoft), durées (retrait,
  déconnexion via `PushLogout`, suppression du compte, 404/410 supprimés à l'envoi). Le cadre de
  transfert hors UE n'est PAS cité (commentaire HTML « à vérifier avec le conseil juridique »).
- **Autopsie (#669)** : ligne Anthropic (faits de `buildIncidentPrompt` seulement : type d'incident,
  devise, trades de la séance, alertes, comparaisons ; ni note, ni libellé, ni firm) et durée :
  `aiAnalysis` vit avec le `TradingAccount` (cascade) ; « Retirer cette autopsie » pose `dismissedAt`,
  n'efface pas le texte.
Toute évolution de ces champs, du payload push ou du prompt d'autopsie → mettre la page à jour.

<!-- Origine : security.md · Événements d'usage rattachés au compte (2026-10-25) · 2026-10-25 -->
> **Origine** : `security.md` · « Événements d'usage rattachés au compte (2026-10-25) » · 2026-10-25

## Événements d'usage rattachés au compte (2026-10-25)

`ProductEventDaily` porte le `userId` : ces compteurs ne sont PAS anonymes (≠ `LandingVisitDaily` et
parcours d'inscription, sans identifiant). La politique (1.d, 2, 3) les déclare : offre Premium,
installation de l'app, activation des notifications, plateforme seule (`android`, `ios`, `ios-other`,
`desktop`) ou écran ; base intérêt légitime ; **13 mois, puis effacement automatique, ou à la
suppression du compte** (purge quotidienne `RetentionCron.scheduledDailyPurge`, cascade
`onDelete: Cascade`, `retention.int-spec.ts`). Les choix « Plus tard » / « Ne plus me proposer »
restent dans le navigateur. Nouvel événement → liste blanche `PRODUCT_EVENTS` ET la page.
Journal de `ProductEventsService.record` : nom de l'erreur seulement, jamais `err.message` (une
erreur Prisma recopie la requête, donc l'identifiant du compte) ; testé avec contre-épreuve.

<!-- Origine : security.md · Identifiants Stripe des places et remises sans compte (#826, 2026-11-01) · 2026-11-01 -->
> **Origine** : `security.md` · « Identifiants Stripe des places et remises sans compte (#826, 2026-11-01) » · 2026-11-01

## Identifiants Stripe des places et remises sans compte (#826, 2026-11-01)

`FounderSeat` et `PartnerRedemption` gardent `stripeSubscriptionId` après la suppression du compte
(`userId` passe à null par `onDelete: SetNull`). Règle : **effacement par le cron à 180 jours**,
jamais à la suppression du compte ni dans le webhook (`releaseUnpaid`, `markLost` et
`PartnerCodeService.end` retrouvent la ligne par cet identifiant tant qu'elle est ACTIVE).
`RetentionCron.detachStripeIds`, appelé par la purge mensuelle (1er du mois, 4 h 30) : efface quand
`userId` nul, statut ≠ ACTIVE et `endedAt` de plus de 180 jours (`STRIPE_IDS_RETENTION_DAYS`, délai des
litiges tardifs). Jamais touchées, seulement comptées et signalées (`warn`) : ligne ACTIVE sans compte
(webhook de fin jamais traité) et ligne terminée sans `endedAt`. Une place RELEASED d'un compte vivant
(`releaseUnpaid` détache la place) suit la même règle. Couvert par `retention.cron.spec.ts` et
`retention.int-spec.ts` (179/181 j, ACTIVE, sans fin, compte lié, rejeu).

## Tirage au sort mensuel déclaré dans la politique de confidentialité (#1150, 2026-11-21)

Politique de confidentialité (`politique-confidentialite.astro`, mise à jour du 21/11) : section 1 h)
(données lues pour la participation, trace du tirage, lot, et seulement avec accord : nom à afficher,
message ≤ 140, accord et pseudo Instagram), deux finalités (tirage : exécution du contrat ; affichage
du gagnant et Instagram : consentement) et une ligne de conservation (trace et lot sans limite pour
l'instant ; à la suppression du compte, lien, nom, message et pseudo Instagram effacés par `deleteMe`).
Ouverture du verrou d'activation en prod (`GIVEAWAY_PROD_ACTIVATION_OPEN = true`) dans le même commit,
condition posée par l'agent security au lot A. Journaux du module : `safePrizeError` (code de
l'erreur, jamais le message brut Stripe ou Prisma). La publication Instagram (Metricool, lot C)
ajoutera un destinataire à la section 4.
