# Mes comptes : plan prop firm et synchro en pause

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · « Quel est ce compte ? » — liaison au plan prop firm (#612, 2026-10-18) · 2026-10-18 -->
> **Origine** : `angular.md` · « « Quel est ce compte ? » — liaison au plan prop firm (#612, 2026-10-18) » · 2026-10-18

## « Quel est ce compte ? » — liaison au plan prop firm (#612, 2026-10-18)

`features/accounts/account-plan-wizard` (`mtc-account-plan-wizard`, entrée `accountId`, sortie
`done`) : un choix par écran, firm → taille → phase (si le catalogue en distingue deux) → programme.
Charge lui-même catalogue + `AccountsApi.planHint`, enregistre lui-même (PATCH) et émet le compte :
le parent recharge son store. Pré-sélection via `guessPlan` (`@mtc/shared`) : `found` → « On dirait
un Apex 50K » Oui / Changer · `personal` → « compte perso ? » · `ambiguous` → firm pré-choisie,
écran taille · `none` → firm. Le **programme** n'est jamais deviné. « Compte perso », « Ma firm
n'est pas dans la liste » et « Plus tard » posent `planLinkChoice`. Disclaimer d'estimation en pied.

- Branché **après** `selectThenSync` réussi (historique importé = solde de départ connu) :
  onboarding étape 8 (`tvPlanAccountId`, les autres options masquées, puis étape 9 sur `done`) et
  Mes comptes (modale `plan-wizard-modal`, feuille pleine largeur < 768 px), compte sans plan.
- Champ texte en `[value]` + `(input)` (pas `ngModel`, asynchrone : intestable sans `whenStable`).
- **Rattrapage** (« plan à renseigner » = `needsPlanLink` de `@mtc/shared` : prop firm sans plan ou
  `LATER`, jamais archivé / `PERSONAL` / `UNLISTED`) : bandeau `plan-link-<id>` sur la ligne de Mes
  comptes (bouton « Relier » → même modale, **pas de masquage** : l'ancien bandeau masquable en
  localStorage et limité aux comptes qui collaient à un plan a été retiré) ; Session live : bloc
  `live-prop-firm-plan-cta` **à la place des 3 jauges**, hauteur fixe `3 × 61 px + 2 écarts` (jauge mesurée au banc local) (la
  colonne ne saute pas quand le plan est relié), modale au palier 1000. Pas de modale bloquante, pas d'email.

<!-- Origine : angular.md · Mes comptes : synchro en pause (#684, 2026-11-02) · 2026-11-02 -->
> **Origine** : `angular.md` · « Mes comptes : synchro en pause (#684, 2026-11-02) » · 2026-11-02

## Mes comptes : synchro en pause (#684, 2026-11-02)

Connexion avec `syncPaused` (compte Échoué ou Archivé depuis 48 h ou plus, historique importé) :
pastille « En pause » (`tv-pill off`) à la place de « ● Connecté », ligne « Dernière synchro »
masquée, sous-ligne `tradovate-paused-<id>` avec le texte validé (« échoué » ou « archivé » selon
`syncPausedReason`). « Synchroniser » et « Déconnecter » restent. Déconnexion : « Déconnecter
Tradovate de ce compte ? », puis, s'il y a des trades importés, « La synchro s'arrête. Tes trades
déjà importés restent, sauf si tu choisis de les supprimer. » Jamais le mot « révoqué » dans ces
textes (la déconnexion supprime nos jetons, elle ne révoque rien chez Tradovate).

## Vue multi-comptes : le compte le plus exposé en premier (#668)

- **Exposition** (`core/utils/account-exposure.util.ts`, `accountExposure`) = la plus petite marge
  restante en part de la limite : marge avant le plancher, et perte max du jour si l'API la renvoie
  (Premium avec plan relié). L'objectif n'entre pas en compte. Montant non publié
  (`drawdownUnconfirmed`) ou aucune règle : pas d'exposition.
- **Mes comptes, vue « Tous les comptes »** (`groupByExposure`) : comptes actifs suivis du plus exposé
  au moins exposé (égalité : ordre de l'API), puis comptes actifs sans marge (personnel, firm hors
  catalogue), puis le groupe **« Sans plan relié »** (`needsPlanLink`, sans marge calculable, bouton
  « Relier » de la ligne), puis validés et échoués ; archivés repliés comme avant. Un compte à
  règles manuelles a une vraie marge : trié avec les autres, il garde son bandeau « Relie ce compte… ».
- **« Le plus exposé »** : étiquette sous le nom et liseré à la couleur de sa marge la plus serrée
  (`drawdownTone`, même règle qu'en Session live), à partir de 2 comptes suivis et seulement en vue
  « Tous les comptes ». Infobulle : quelle marge (plancher seul pour un compte sans perte max du jour).
- **Colonnes** : Objectif « … $ pour l'objectif » + % ; `ddLabels.margin` (marge en $ + %) ; nouvelle
  colonne **« Perte max du jour »** (restant en $ + %, « limite atteinte ») ; compte gratuit relié à un
  plan : badge PREMIUM en pointillé qui ouvre la fenêtre Premium (pas de flou). 9 colonnes, repli du
  tableau à 1100 px. Heure du relevé broker visible sous le solde (« relevé il y a 4 min »).
- **« À surveiller »** : `isAtRisk`, marge la plus serrée (perte max du jour comprise) ≤ `ALERT_WARNING_PCT` ; sous-titre « proche d'une limite » (plus seulement le plancher).
- **Gating** : ouvert à tous les plans (décision du 22/11, `MULTI_ACCOUNT_VIEW_FOR_ALL_PLANS`) ; la
  perte max du jour reste Premium (calculée seulement en Premium par l'API).
- Specs : `account-exposure.util.spec.ts`, `accounts-multi-comptes.spec.ts` (vrai gabarit),
  `live-accounts-strip.component.spec.ts`.

