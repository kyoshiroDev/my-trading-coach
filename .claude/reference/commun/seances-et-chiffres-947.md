# Séances, périodes et chiffres affichés (#595, #947, #1000)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Session active = journée de trading en cours (#595) · 2026-10-17 -->
> **Origine** : `nestjs.md` · « Session active = journée de trading en cours (#595) » · 2026-10-17

### Session active = journée de trading en cours (#595)

Ne jamais écrire `where: { userId, status: ACTIVE }` sur `TradeSession` : passer par
`activeSessionWhere(userId)` (`modules/session/active-session.ts`), qui ajoute
`startedAt >= tradingDayStart(now)` (17:00 Chicago, cf. `tradingDay`). Une session d'une
journée précédente n'est jamais renvoyée comme active (chrono à 265 h, P&L du jour rapporté à
une session de 11 jours). Seul `startSession` ferme encore TOUTES les `ACTIVE` sans borne.

<!-- Origine : nestjs.md · Clôture d'un trade depuis la séance (#947) · 2026-11-11 -->
> **Origine** : `nestjs.md` · « Clôture d'un trade depuis la séance (#947) » · 2026-11-11

### Clôture d'un trade depuis la séance (#947)
`SessionService.closeTrade` (`POST /session/trades/:id/close`) calcule le P&L par `calculatePnl`
(valeur du tick × quantité, ou capital engagé) : jamais l'écart de prix brut (avant : MNQ 2 contrats
+10 pts enregistré 10 $ au lieu de 40 $).

<!-- Origine : nestjs.md · Totaux stockés d'une séance clôturée (#947) · 2026-11-11 -->
> **Origine** : `nestjs.md` · « Totaux stockés d'une séance clôturée (#947) » · 2026-11-11

### Totaux stockés d'une séance clôturée (#947)
`TradingSession.totalPnl / winRate / totalTrades / maxDrawdown / bestTrade*` sont écrits à la clôture,
puis RECALCULÉS par `refreshClosedSessionTotals` (`session/refresh-session-totals.ts`, même
`sessionTotalsFrom` que la clôture) dès qu'un de leurs trades change : `TradesService.update`, `remove`,
`removeBrokerImported`, `reassignAccount`, `refreshAfterFeesRepair`, et `SessionService.closeTrade`.
Toute nouvelle écriture sur un trade rattaché à une séance passe par lui.

<!-- Origine : nestjs.md · Réparation des séances : trades d'autres journées (#1000) · 2026-11-14 -->
> **Origine** : `nestjs.md` · « Réparation des séances : trades d'autres journées (#1000) » · 2026-11-14

### Réparation des séances : trades d'autres journées (#1000)
Avant N1 (#994, lot 1b), un import d'historique pendant une séance y rattachait tous les trades passés.
`POST /api/admin/sessions/repair-days` (ADMIN, `session/admin-sessions.controller.ts`, synchrone, la
réponse est le rapport) : essai par défaut, `?apply=true` écrit. Règle (`session/session-days-repair.ts`,
pures) : trade hors de la journée CME de sa séance → séance de SA journée si une seule compatible (même
utilisateur, même compte ou séance sans compte), sinon `sessionId` null (rapport : `detachedNoSession` / `detachedAmbiguous`) ; trade d'un autre compte que sa
séance (#457) non traité. Avant écriture : sauvegarde JSONL (rattachements + totaux d'avant) en Redis
30 j, `GET …/repair-days/backup?at=AAAAMMJJ-HHMM` ; déplacements conditionnels, puis
`refreshClosedSessionTotals` et invalidation du cache analytics. Verrou Redis, comptes démo exclus.
Effet voulu : un trade sans émotion saisie prend l'humeur de sa nouvelle séance (`inheritedEmotion`).

<!-- Origine : nestjs.md · Filtre Gagnants / Perdants / BE du journal (#947) · 2026-11-11 -->
> **Origine** : `nestjs.md` · « Filtre Gagnants / Perdants / BE du journal (#947) » · 2026-11-11

### Filtre Gagnants / Perdants / BE du journal (#947)
Classé sur le NET arrondi (`TRADE_NET_SQL` = `round(pnl − |commission|, 2)`), comme les stats. Prisma ne
sait pas comparer `pnl − |commission|` : la liste passe par `resolveTradeWhere` (ids sélectionnés par
`buildTradeFilterSql`), jamais par `buildTradeWhere` seul quand `result` est posé.

<!-- Origine : angular.md · Périodes et chiffres affichés (audit des chiffres, #947) · 2026-11-11 -->
> **Origine** : `angular.md` · « Périodes et chiffres affichés (audit des chiffres, #947) » · 2026-11-11

## Périodes et chiffres affichés (audit des chiffres, #947)
- **Bornes de période** : la fin d'une période glissante est la **fin de la journée** (23:59:59.999), jamais
  `new Date()` dans un `computed` (figé à l'ouverture : un trade saisi ou importé ensuite sortait des KPI).
  Tableau de bord : `periodRange.to` ; Journal : `presetRange` (aujourd'hui / semaine / mois / perso).
- **Semaine = lundi → dimanche** (ISO) partout, préréglage « Cette semaine » du Journal compris.
- **Période perso** : début à minuit LOCAL (`'AAAA-MM-JJ' + 'T00:00:00'`), jamais `new Date('AAAA-MM-JJ')`
  (lu en UTC : la première heure du jour exclue à Paris).
- **Tableau de bord** : by-setup, by-emotion et top-assets reçoivent la même `rangeQuery()` que les KPI.
  Donut des émotions = `emotionSharesFromStats(by-emotion)` pour TOUS les plans (by-emotion est FREE).
  Donut « répartition stratégies » FREE = 6 derniers trades (by-setup est Premium) avec le sous-titre
  « Sur tes 6 derniers trades » : jamais un chiffre sous un sélecteur de période qu'il ne suit pas.
  Libellés de période (`periodShort`) : jamais « ce mois » en dur (KPI Trades pris, coach).
- **Récap du matin** : la carte montre la dernière journée tradée (API, 7 jours) ; « Hier · » seulement si
  c'est hier (`recapIsYesterday`), sinon le nom du jour.
- **Mes comptes** : « P&L cumulé » = `metrics.tradingPnl` (payouts rajoutés), jamais `realizedPnl`.
- **Pourcentages** : un seul format, `formatPercent` (`@mtc/shared`) ou le pipe `pct` (`@mtc/front-ui`) :
  « 63% » (entier par défaut), « — » si inconnu, « 0% » pour zéro (jamais « - »), jamais « -0% ».
  Pas de `number:'1.0-1'` + « % » à la main, pas de `toFixed` pour un win rate.
- **Montants** : `money` / `formatMoney` dans la devise du compte, jamais « $ » en dur ; un montant
  négatif passe le signe au formateur (`(0 - x) | money`), jamais « -{{ x | money }} » (« -$0.00 »).
- **Formulaire de trade en édition** : levier retrouvé depuis le P&L stocké (`editLeverage`), % sur le
  capital engagé (`editPnlPct`), R/R par `plannedRiskReward` (avec le sens).
- **« 1M / 3M / 6M » = mois CALENDAIRES** partout (`rollingRange`, `core/utils/rolling-period.util.ts`) :
  tableau de bord et Statistiques ont la même fenêtre, jamais 30 / 90 / 180 jours.
- **Statistiques** : le sélecteur de période est au-dessus des KPI (tous les plans) et TOUS les chiffres
  le suivent (summary, by-hour, top-assets, by-setup via `rangeQuery()`, courbes) ; seul le calendrier
  d'activité garde sa navigation par mois.
- **Win rate d'une liste de séances** = Σ gagnants ÷ (Σ gagnants + Σ perdants) (`sessionsWinRate`,
  `wins`/`losses` renvoyés par `/session/history`), jamais une moyenne des win rates de séance.
  Même règle pour la fraction des en-têtes du Journal (`winCount/(winCount + lossCount)`, BE et ouverts
  exclus) et le score (consistance par setup via `computeTradeStats`, pertes sur le net).
- **Débrief de la séance du jour** : trades de LA séance (`sessionScopedTrades`), relus à la clôture
  (`SessionStore.applyClosed`) ; jamais ceux d'une autre séance du même jour.
- **Devises** : la devise de « Tous les comptes » = celle des comptes COMPTÉS (`aggregateCurrency`, sans
  les perdus exclus des totaux). Devises mêlées → aucune somme : « Devises mixtes » (sélecteur), « — »
  + `mtc-mixed-currency-notice` (Sessions, Mes comptes, admin). Ligne d'un compte (séance, onglet du
  débrief, trade) → `pnlFormat : null : accountId` / `money:…:accountId`. Champs de saisie :
  `currencyAffix`. Garde : `no-hardcoded-dollar.spec.ts` échoue sur un « $ » en dur dans un gabarit.
- **% d'un trade** (derniers trades du tableau de bord) : sur le capital du compte DU trade, jamais sur
  la somme des comptes.
- **Commission ambassadeur** affichée = `monthlyCommission` calculée par l'API (20 % du payé réel).
