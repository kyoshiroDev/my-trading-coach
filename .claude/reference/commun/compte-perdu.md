# Compte perdu : comptes échoués et archivés (#677, #681)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md`, `.claude/agents/tests.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Compte perdu : comptes échoués et archivés hors des agrégats (#677, #681, 2026-10-21) · 2026-10-21 -->
> **Origine** : `nestjs.md` · « Compte perdu : comptes échoués et archivés hors des agrégats (#677, #681, 2026-10-21) » · 2026-10-21

## Compte perdu : comptes échoués et archivés hors des agrégats (#677, #681, 2026-10-21)

**Règle : aucune agrégation « tous les comptes » sans filtre de statut.** Les comptes `FAILED`
(Échoué) et `ARCHIVED` (Archivé) sortent PAR DÉFAUT de toute statistique ou agrégation qui porte
sur l'ensemble des comptes de l'utilisateur. `PASSED` (Validé) reste compté. Les trades sans compte
restent comptés. Un compte précis (`accountId`) reste lisible quel que soit son statut, et le
paramètre `includeInactive=true` réintègre tout.

**Source unique : `accounts/account-status-scope.ts`**, jamais une copie locale du filtre :

| Fonction | Usage |
|---|---|
| `inactiveAccountsTradeWhere(scope)` | filtre Prisma des trades (`where`) |
| `inactiveAccountsTradeSql(scope)` | même filtre en SQL brut, table `"Trade"` aliasée `t` |
| `inactiveAccountsSessionWhere(scope)` | même filtre sur les SÉANCES (historique des sessions) |
| `activeAccountsWhere(scope)` | filtre des COMPTES d'un contexte global (débrief, IA) |
| `excludesInactiveAccounts(scope)` | vrai = « tous les comptes » sans les inactifs |
| `parseIncludeInactive(value)` | lit `includeInactive` d'une query (`true` / `1`) |

- Le filtre Prisma renvoie une clé `OR` : dans un `where` qui a déjà un `OR`, combiner par
  `AND: [a, b]`, jamais par deux spreads (le second écraserait le premier).
- Les versions Prisma et SQL sont prouvées équivalentes sur vraie base par
  `account-status-scope.int-spec.ts` (et `analytics-sql-equivalence.int-spec.ts`).
- Appliquée à : les 10 routes `/analytics/*` (+ `includeInactive`, clé de cache distincte
  `:inactive` dans `analytics.service`), débrief hebdo, récap quotidien (combinée par `AND` avec
  l'exclusion des comptes d'entraînement), chat du coach (`accountId` facultatif, propriété vérifiée),
  insights IA et orchestrateur, journal (liste ET chiffres, voir ci-dessous), historique des
  sessions (`GET /sessions/history`, + `includeInactive`), e-mail « premier récap de semaine »
  (`loadFirstWeek`).
- **Journal : liste et chiffres sur le MÊME jeu de trades (2026-11-09, remplace « la liste n'est pas
  filtrée » de #681).** Le filtre est DANS `buildTradeWhere` / `buildTradeFilterSql`
  (`trade-filters.util.ts`, `tradeFiltersScope`) : `GET /trades` (liste, donc les en-têtes de jour et
  de semaine, « partiel » et « 20+ » calculés dessus côté front) et `GET /trades/stats`
  (`journalStatsForFilters`, qui renvoie aussi `excludedAccounts { failed, archived }`) l'appliquent
  à l'identique. Par défaut, comptes échoués et archivés hors de la liste ET des chiffres ;
  `includeInactive=true` les réinclut dans les deux (badge côté front) ; un compte précis reste
  lisible. Ne jamais rajouter le filtre à un seul des deux. Couvert par
  `trades/journal-lost-accounts.int-spec.ts` (cas réel du 09/11) et `journal-stats-sql.int-spec.ts`
  (équivalence Prisma ↔ SQL, `includeInactive` compris).
- Changement de statut, archivage, suppression : `invalidateStats(userId)`, sinon le cache
  servirait les anciens chiffres.

**Volontairement NON filtrés (ne pas « corriger »)** :
- **Base de comportement et alertes de tilt** (`behavior-baseline.service.ts`,
  `tilt-alerts.service.ts`) : elles comptent TOUS les comptes, échoués et archivés compris.
  C'est le comportement habituel du trader qui sert de référence. Retirer les comptes perdus
  fausserait cette référence juste après un compte perdu, précisément quand le risque de tilt est
  le plus haut. Un commentaire le rappelle dans le code.
- Les chiffres propres d'un compte (`account-rules.ts`, versions SQL et JS) : ils décrivent CE compte.
- Fiches et statistiques admin, et le contexte prop firm de l'IA (déjà limité aux comptes ACTIVE).

**Avant toute nouvelle agrégation sur les trades ou les comptes** : passer par
`account-status-scope.ts` (ou justifier par écrit, dans le code, pourquoi la base doit compter les
comptes perdus, comme la base de comportement), accepter `includeInactive` si la route est une
statistique, ajouter un test « compte FAILED ou ARCHIVED exclu par défaut, inclus avec
`includeInactive`, compte précis lisible ».

**Routes du compte perdu (`accounts.controller.ts`)** :
- `GET /accounts` : chaque compte porte `floorReached` (`isFloorReached`, `account-retry.ts`) :
  compte ACTIVE avec des règles de perte maximale (plan du catalogue ou drawdown saisi, même calcul
  de marge) et marge estimée ≤ 0. **Aucun statut n'est changé automatiquement** : l'utilisateur confirme.
  Plancher écarté par « Ce n'est pas un échec » (B1) : le retrait garde `dismissedMargin` et
  `dismissedDay` (journée CME) dans le JSON `data` de l'incident (pas de table, pas de migration) ;
  `floorReached` reste faux tant que la marge ne descend pas plus bas (tolérance 1). `list` efface ce
  retrait dès que la marge repasse au-dessus de zéro ou à la séance suivante (rare écriture dans une lecture,
  `clearExpiredFloorDismissals`) : jamais bloquante (try/catch, journal sans données ni id) et conditionnelle
  (`updateMany` seulement si l'incident porte ENCORE ce retrait : deux lectures simultanées sans effet
  croisé, un retrait plus récent jamais effacé).
- `POST /accounts/:id/retry` : nouvelle tentative d'un compte `FAILED` du propriétaire (409 sinon,
  404 pour un autre utilisateur). Même firme, plan, taille et règles (`retryAccountData`), le plan
  étant recopié même s'il n'est plus vendu (#1242) ; rien
  n'est copié (trades, connexion broker, dernier payout). Libellé incrémenté côté serveur par
  `nextAttemptLabel` (`@mtc/shared`, partagé avec l'app qui l'annonce avant la création :
  « Apex 50K #2 », plus grand numéro + 1). Quota du plan appliqué.
  Tentative plus récente déjà créée (même base, numéro plus grand : `newerAttempt`) → **409
  `RETRY_EXISTS`**, vérifié AVANT le quota (jamais « Passe à un plan supérieur » dans ce cas). Lecture,
  contrôles et création sous `pg_advisory_xact_lock(hashtextextended('account-retry:<userId>', 0))` :
  deux requêtes simultanées ne créent qu'un compte (int-spec `account-status-scope`). Le filtre
  global ne renvoie que `code` et `message` : l'app retrouve le compte dans la liste.
- `DELETE /accounts/:id/permanent` : suppression DÉFINITIVE d'un compte de trading et de ses trades.
  Corps `{ "confirm": true }` obligatoire (400 sinon), propriétaire seulement (404), démo refusée
  (403, `DemoReadOnlyGuard`). Une transaction : trades, séances, connexion broker (la synchro ne peut
  plus recréer les trades), puis le compte (cascades : clôtures, payouts, journal de risque,
  événements prop firm, alertes de comportement). Réponse `{ deleted: true, tradesDeleted }`.
  Compte MyTradingCoach et Stripe intacts. Couvert par `account-purge.int-spec.ts`.
- `DELETE /accounts/:id/archived` (Mes comptes, 2026-11-06) : suppression DÉFINITIVE d'un compte
  **ARCHIVÉ** et de tous ses trades. Corps `{ "confirm": true }` (400), propriétaire (404), statut
  ARCHIVED exigé (**409 `ACCOUNT_NOT_ARCHIVED`**, garde rejouée DANS la transaction par
  `tradingAccount.deleteMany({ id, userId, status: ARCHIVED })` : un désarchivage concurrent annule
  tout). Même transaction que `permanent` + `BehaviorBaseline` du user effacée s'il y avait des
  trades (recalculée à la lecture suivante). `GET /accounts/:id/deletion-preview` → `{ archived,
  tradesCount (TOUS les trades, ouverts compris), sessionsCount, brokerConnected }` pour la modale.
  `/permanent` (parcours « compte perdu ») n'exige PAS l'archivage. `DeletedAccount` et la règle des
  90 jours d'essai ne concernent que la suppression du User. Couvert par
  `account-delete-archived.int-spec.ts` et `accounts-delete-archived.spec.ts`.
- `DELETE /accounts/:id` est inchangé : il ARCHIVE dès qu'il y a de l'historique, et SUPPRIME un
  compte sans trade ni séance. Pour archiver à coup sûr, le front passe par `PATCH { status: 'ARCHIVED' }`.

### Pause de la synchro des comptes perdus (#684, 2026-11-02)

Règle unique dans `integrations/tradovate/tradovate-sync-pause.ts` : la synchro de fond d'un compte
`FAILED` ou `ARCHIVED` est en pause quand son statut date de **48 h ou plus** (`statusChangedAt`,
`null` = ancien) **et** que `historyImportedAt` est posé. `PASSED` n'est jamais en pause.
- Filtre `notSyncPausedWhere(now)` : cron de fond (`tradovate-background-refresh.cron.ts`) et
  `trackableConnection(now)` (temps réel `eligible()` et compteur de la veille #770). Jamais d'autre
  copie du filtre.
- **Inchangés :** statut `CONNECTED` de la connexion (une sœur qui propage ses jetons ne lève donc pas
  la pause), cron des jetons (renouvellement maintenu), bouton « Synchroniser » (manuel, ne lève pas la
  pause), trades déjà importés.
- `statusChangedAt` est écrit par `AccountsService.update` (tout changement de statut, y compris via
  `AccountIncidentsService.updateAccount`) et par `remove` quand il archive. Un nouveau chemin qui
  change le statut doit l'écrire aussi.
- Retour en `ACTIVE` d'un compte en pause : `historyImportedAt` remis à `null` sur ses connexions, et
  le cron reprend l'historique complet (dédup par trade) pour combler la période de pause.
- Vue (`toConnectionView`) : `syncPaused` et `syncPausedReason`, calculés, sans colonne.
- Push de reconnexion (`noticeReconnectRequired`) : coupé côté trader pour un compte `FAILED` ou
  `ARCHIVED`, gardé côté admin.
- Tests : `tradovate-sync-pause.spec.ts`, `tradovate-sync-pause.int-spec.ts` (filtre sur vraie base).

### Journal d'observation Tradovate (#684 phase 2, 2026-11-03)

But : savoir, avec de vraies données, ce que Tradovate renvoie pour un compte échoué, archivé ou
fermé, avant de décider d'un signal « compte fermé chez Tradovate ». **Observe seulement** : aucune
synchro, aucun statut, aucune pause ne lit cette table.
- `TradovateObservationCron` (`tradovate-observation.cron.ts`, `40 6 * * *` Paris), fonctions pures
  dans `tradovate-observation.ts`. Cible : connexions `CONNECTED` avec compte choisi, hors démo, pas
  encore notées ce jour (`observations: { none: { day } }`). Les comptes en pause (#684) sont compris :
  ce sont eux qu'on veut voir.
- **Un appel `/account/list` par login et par jour** : groupe = même utilisateur MTC + même
  `externalUserId` (repli sur la connexion) + même hôte. Lecture avec la première sœur verrouillable
  (`tryLock`, même verrou que la synchro) ; toutes occupées → groupe sauté pour la journée.
- Une ligne par connexion : `outcome` (`OK`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `PENALIZED`,
  `NOT_FOUND`, `UNAVAILABLE`, `TOKEN_REFUSED`, `TOKEN_DEFERRED`, `ERROR`), `httpStatus`, `listed`,
  `active`, `closed`, `restricted` (bruts, null si absent ou non lu), plus le contexte MTC
  `accountStatus`, `syncPaused`, `lastSyncAt`. Ni jeton, ni montant, ni nom ou identifiant Tradovate.
- Pénalité reçue → `notePenalty` comme ailleurs ; pause en cours → aucun appel, ligne `PENALIZED`.
- Idempotent (`@@unique([connectionId, day])`, `createMany … skipDuplicates`), purge au-delà de
  `OBSERVATION_RETENTION_DAYS` (90), cascade avec la connexion. Journal : une ligne de nombres par passage.
- Pourquoi une table et pas des logs : les journaux des conteneurs ne survivent pas à un déploiement.
- Tests : `tradovate-observation.spec.ts`, `tradovate-observation.int-spec.ts` (migration, unicité, cascade).

<!-- Origine : angular.md · Compte perdu (#681, 2026-10-21) — statistiques sans les comptes échoués et archivés · 2026-10-21 -->
> **Origine** : `angular.md` · « Compte perdu (#681, 2026-10-21) — statistiques sans les comptes échoués et archivés » · 2026-10-21

## Compte perdu (#681, 2026-10-21) — statistiques sans les comptes échoués et archivés

Miroir front de la règle API (`nestjs.md`, « Compte perdu ») : **aucun chiffre « tous les comptes »
sans filtre de statut**. `FAILED` et `ARCHIVED` sont exclus par défaut, `PASSED` compté, un compte
choisi dans le sélecteur s'affiche toujours (même échoué ou archivé).

**Règle partagée : `core/utils/account-status.util.ts`** (`countsInAggregate`, `isInactiveStatus`,
`statusLabel`, `statusBadgeClass`, `excludedAccountsLine`). Jamais de `status !== 'ARCHIVED'` recopié
dans un composant.

**`SelectedAccountStore`** porte l'état :
- `includeInactive` (interrupteur, **non persisté**, remis à faux par `reset()`), `setIncludeInactive()` ;
- `inactiveIncluded` (l'interrupteur ne joue qu'en « Tous les comptes ») ;
- `aggregateAccounts` : comptes qui entrent dans le capital et les soldes agrégés ;
- `excludedAccounts` `{ failed, archived }` pour la ligne « n comptes exclus des chiffres » ;
- `statsParams()` / `statsQuery()` : `accountId` d'un compte précis, sinon `includeInactive=true`
  quand l'interrupteur est actif, sinon rien.
- Un compte archivé ou échoué **reste sélectionnable** : `load()` ne renvoie sur « Tous » que si le
  compte a disparu.

Toute ressource de statistiques passe par `statsQuery()` / `statsParams()` (dashboard, analytics,
courbe journalière, calendrier). Le capital agrégé lit `aggregateAccounts()`
(`viewBalance(…, includeInactive)` en 4e paramètre). Les URL ne changent pas quand un compte change
de statut : dashboard, analytics et journal ont un `effect` sur `excludedAccounts()` qui recharge
les chiffres (jamais au premier passage).

**Écrans** (maquette `maquettes/mockup-compte-perdu.html`) :
- `features/accounts/lost-account/floor-reached-banner` (`mtc-floor-reached-banner`) : un bandeau
  par compte `floorReached`, en haut du dashboard et de Mes comptes. « Pas maintenant » masque CE
  compte 24 h (`floor-snooze.util.ts`, clé `mtc.floorSnooze`). Hôte en `is-empty` (display none)
  sans bandeau.
- `core/services/lost-account-flow.service.ts` (`LostAccountFlowService`, root) : feuille de choix et
  feuille « nouvelle tentative » (états par **id**). **Rien n'est enregistré avant « Confirmer »**.
  Archiver et « garder comme échoué » = `PATCH status` (**jamais `DELETE /accounts/:id`**, qui
  supprimerait un compte sans trade) ; supprimer = `ConfirmService` (danger, rappel compte MTC et
  abonnement) puis `DELETE /accounts/:id/permanent` ; un 404 vaut succès ; puis `store.load()` et
  `tradesStore.reset()`. Ouvert depuis l'alerte live, il charge la liste des comptes si besoin.
- `features/accounts/lost-account/lost-account-sheets` (`mtc-lost-account-sheets`) : monté UNE fois
  dans la coque (`sidebar.component.html`). Feuille en bas d'écran < 768 px, boîte centrée au-delà,
  `mtcDialog`, vrais boutons radio (« Archiver » coché à chaque ouverture).
- `shared/components/inactive-accounts-toggle` (`mtc-inactive-accounts-toggle`) : ligne + interrupteur
  (`role="switch"`), sur le dashboard, les statistiques, le journal et l'historique des sessions ; visible seulement en « Tous les
  comptes » s'il existe un compte échoué ou archivé.
- Alerte live : `PropAlertsService` ajoute l'action « Marquer comme échoué » au toast
  `drawdown` / `breached` (et à lui seul). `ToastOptions.action` / `ToastService.runAction()` : le
  bouton `.toast-action` est exclu de la capture du pointeur (glisser pour fermer), comme la croix.
- Mes comptes : badge `.status-badge` (Actif, Validé, Échoué, Archivé), liseré rouge d'un compte échoué
  (`accentVar`, car le style en ligne `--ac` bat une classe), sous-ligne « Hors statistiques » avec
  « Nouvelle tentative » et « Archiver » (44 px), archivés dans un `<details>` replié. La ligne est un
  `<ng-template #acctRow>` rendu par `NgTemplateOutlet` (liste principale + section archivée).
- Sélecteur de compte : groupe « Hors statistiques » avec badge ; solde de « Tous » = `aggregateAccounts`.
  Compte échoué ou archivé choisi : ligne discrète sous le sélecteur (`selected-inactive-note`,
  « Ce compte est échoué : il ne compte pas dans « Tous les comptes ». », ton des notes, sans couleur d'alerte).
- **Période par défaut d'un compte échoué ou archivé** (`core/utils/inactive-period.util.ts`) : ses
  trades sont souvent plus vieux que « 1 mois ». Tableau de bord et Statistiques passent sur « Tout »
  quand on le choisit ; le calendrier des Statistiques s'ouvre sur le mois de son dernier trade
  (`TradesApi.getAll({ accountId, limit: '1' })`). Retour sur un compte actif : période et mois d'avant
  reviennent. Un choix de l'utilisateur (`setPeriod`, `selectPeriod`, `onMonthChange`) prime et
  désarme le retour automatique. Comptes actifs : inchangés.
- **Connexion Tradovate : comptes ACTIVE seulement** (`canConnect` dans Mes comptes, « Connecter » et
  « Reconnecter » ; l'import CSV ne cible déjà que `activeAccounts()`). Une connexion DÉJÀ établie sur
  un compte qui devient échoué, validé ou archivé n'est pas touchée : elle reste `CONNECTED` et la
  synchro continue côté API (décision en attente, issue #683).
- Journal (2026-11-09, remplace « la liste garde tout ») : UN SEUL jeu de filtres `journalFilters`
  (avec `includeInactive` quand l'interrupteur est actif) pour la liste ET les KPIs. Par défaut, les
  trades des comptes échoués et archivés ne sont ni dans la liste, ni dans les en-têtes de jour et de
  semaine, ni dans la barre ; l'interrupteur recharge les deux et les fait entrer partout, avec le
  badge (la cellule de l'actif passe à la ligne au lieu de couper le badge). Compte marqué échoué /
  archivé : liste et KPIs rechargés. Compteur des filtres : « n trades » (plus de « dans les
  chiffres » : liste = chiffres). Test : `journal-lost-account.spec.ts`.
- Tableau de bord, « derniers trades » : `{ limit: '6', ...statsParams() }`, même périmètre que les chiffres ;
  badge « Échoué » / « Archivé » du journal dans `mtc-recent-trades-table` (tableau et carte).
- Historique des sessions : `mtc-inactive-accounts-toggle` sous le sélecteur ; `SessionApi.getSessionsByMonth(…, includeInactive)`
  suit `inactiveIncluded()`, rechargé aussi quand un compte devient échoué / archivé. Test : `sessions-inactive.spec.ts`.
- Mes comptes : « Voir les trades » sur la sous-ligne « Hors statistiques » d'un compte échoué ou
  archivé qui a des trades → `store.select(id)` puis `/journal` (un compte précis s'affiche toujours,
  l'interrupteur n'est pas touché).

⚠️ `src/styles/global.css` n'est importé nulle part : un style global va dans `src/styles.css`
(c'est là qu'est `.status-badge`).

<!-- Origine : tests.md · Compte perdu : tests à maintenir (#677, #681) · 2026-10-21 -->
> **Origine** : `tests.md` · « Compte perdu : tests à maintenir (#677, #681) » · 2026-10-21

## Compte perdu : tests à maintenir (#677, #681)

- **API, règle de statut** : un test par point d'agrégation (compte FAILED ou ARCHIVED exclu par
  défaut, inclus avec `includeInactive`, compte précis lisible, PASSED compté, cas « tous les comptes
  échoués » et « sans compte »). Équivalence Prisma ↔ SQL sur vraie base :
  `accounts/account-status-scope.int-spec.ts`. Suppression définitive : `accounts/account-purge.int-spec.ts`
  (aucun orphelin, autre utilisateur intact, rollback, statistiques exactes juste après, 400 sans
  confirmation, 404, démo 403). Toute nouvelle agrégation ajoute son cas à ces tests.
- **Journal, liste ≡ chiffres (2026-11-09)** : `trades/journal-lost-accounts.int-spec.ts` rejoue le
  cas réel (1 compte actif, 3 trades du 6/11 = −88,50 ; 3 archivés) : interrupteur éteint / allumé,
  semaine = barre, pagination (« partiel », « 20+ ») sur le jeu filtré, compte archivé choisi, plus
  Statistiques, historique des sessions et premier récap de semaine. Horloge figée (`freezeClock`).
  `journal-stats-sql.int-spec.ts` tire aussi `includeInactive` et des comptes ARCHIVED / FAILED.
  Front : `journal-lost-account.spec.ts` (mêmes filtres pour liste et KPIs, en-têtes, badges).
- **Seed démo** (`demo-seed-idempotence.spec.ts`) : les tests de réalisme (fenêtre de 42 jours, win
  rate, journées rouges) portent sur `activeTrades(created)`, le jeu de données principal ; les comptes
  perdus (échoué + sa tentative active, archivé ; volontairement aucun validé) ont leurs propres tests
  (trades antérieurs à la fenêtre, jours ouvrés, plancher dépassé, aucun PASSED, aucune connexion broker).
  `demo-seed-eco.spec.ts` : analyses du faux vendredi au format `{ interpretation, gap }`, écarts
  above/below/above, aucun terme directionnel (`findForbiddenTerms` + regex), relues par `pickReleaseAnalyses`.
- **App, faux `SelectedAccountStore`** : un composant qui lit `statsQuery()`, `excludedAccounts()`,
  `aggregateAccounts()`… plante sur un faux store partiel (« is not a function »). Étaler
  `...statsScopeStub()` (`core/stores/selected-account.store.stub.ts`, tests uniquement) EN PREMIER
  dans le faux store ; ses propres champs (`accounts`, `accountParam`…) priment.
- **Vrai template de Mes comptes** (`accounts.component.html?raw`) : la ligne est un `ng-template`
  rendu par `NgTemplateOutlet`. Une surcharge `imports: [...]` qui l'oublie ne rend AUCUNE ligne,
  sans erreur (NO_ERRORS_SCHEMA) : ajouter `NgTemplateOutlet` aux imports de la surcharge.
- Specs de référence : `lost-account-flow.service.spec.ts`, `lost-account-ui.spec.ts` (bandeau et
  feuilles, vrais templates), `inactive-accounts-toggle.component.spec.ts` (vrai store),
  `accounts-lost-account.spec.ts`, `journal-lost-account.spec.ts` (template lu par `?raw`, pas
  `node:fs`), `account-status.util.spec.ts`, `floor-snooze.util.spec.ts`.
