# Audit · Session live v3 (#594)

> Étape 0 du prompt « Session live v3 » (#593). État de `beta` au commit `59d7f36f`, 2026-10-17.
> Chemins relatifs à `apps/app-mytradingcoach/src/app/` (front) et `apps/api-mytradingcoach/src/` (API) sauf mention.

## 1. Composant et entrées

**Vue** : `features/dashboard/components/session-live/session-live.component.{ts,html,css}` (selector `mtc-session-live`).
Montée par `features/today-session/today-session.component.html:131-146`, qui lui passe tout depuis `SessionStore`.

| Entrée | Source | Usage actuel |
|---|---|---|
| `session` | `store.activeSession()` · `GET /session/today` | CTA si pas `ACTIVE` (html:3), mood (html:55), compte (ts:116-121) |
| `todayTrades` | `store.todayTrades()` · `GET /session/today/trades` | `mtc-live-feed` (html:78-81) |
| `liveStats` | `store.todayStats()` · `GET /session/today/stats` | 4 mini-stats (html:43-62), `broker` → Trade en cours (html:64-70) |
| `ecoCalendar` | `store.ecoCalendarDay()` (socket `/eco` + secours 5 min) | `mtc-live-eco-calendar` (html:73-77) |
| `marketCtx`, `breakingNews` | socket `/eco` | `mtc-market-context-bar` (html:22-35) |
| `newsItems` | `store.newsItems()` | `mtc-live-news` (html:32-34) |

Sous-composants (`session-live/components/`) : `live-position` (Trade en cours, bêta : rôles `BETA_TESTER`/`ADMIN`/`AMBASSADOR`, `live-position.util.ts:156`), `live-prop-firm` (Suivi du compte), `live-feed`, `live-eco-calendar`, `live-news`, `quick-trade`.

**Hors du composant** : le chrono et le bouton « Clôturer » de session sont dans l'en-tête du parent (`today-session.component.html:54-67`, `store.sessionTimer()`), pas dans `mtc-session-live`. Le nouveau bandeau devra soit les reprendre (et masquer la pastille du parent sur l'onglet Live), soit rester dans le parent. À trancher à l'implémentation : je propose de déplacer l'affichage dans le bandeau et de garder `confirmCloseOpen` du parent via un `output()`.

## 2. Position ouverte

Données réelles (`libs/shared/src/contracts/session.ts:27-48`, alimentées par `integrations/tradovate/tradovate-open-positions.ts:35-52` depuis `/position/list` et le WebSocket) :

| Champ | Dispo | Remarque |
|---|---|---|
| Actif | oui | `asset`, symbole normalisé (MNQZ6 → MNQ) |
| Sens | oui | `side` |
| Quantité | oui | `quantity` |
| Prix d'entrée | oui, nullable | `entryPrice` = `netPrice` Tradovate |
| Heure d'ouverture | oui, nullable | `since` = `timestamp` Tradovate |
| Latent | oui, nullable | `openPnl` + `openPnlAt` : **total du compte**, pas par position |
| **Prix actuel** | **non** | cotations refusées (`Prices:Read` non accordé, `docs/tradovate-api-capabilities.md:377`, `:695`) |

**Prix actuel** : pas lu. Avec **une seule position**, on peut le déduire du latent sans nouvel appel : `entrée + latent / (quantité × valeur du point) × (LONG ? 1 : -1)`. Ce n'est exact qu'à la date du relevé (`openPnlAt`, pas de tick). Je propose de l'afficher comme « prix au relevé, il y a X min ». Avec plusieurs positions, ou un latent inconnu, on n'affiche rien.

**Ordres SL / TP : pas lus.** Ni en REST (aucun `/order/list` ni `/orderVersion/list` dans `tradovate-sync.service.ts:216-260`), ni en WebSocket (`LIVE_ENTITY_TYPES = fill, fillPair, position, cashBalance`, `tradovate-live.protocol.ts:29-34`).
- Faisable en lecture seule, sans nouveau scope (`Orders:Read` est accordé, doc `:695`), et sans rate limit REST si on passe par la souscription existante.
- Mais il faut **deux entités de plus**, `order` (lien `parentId`/`ocoId`, `ordStatus: Working`) et `orderVersion` (prix `price`/`stopPrice`, type). Il faut aussi leur jointure, un état Redis et une extension du contrat `LiveBrokerState` (doc `:616-651`). Sur données réelles, la reconstitution n'est **jamais validée** : aucun bracket chez les traders connus (doc `:638-651`).
- Ça dépasse « un appel déjà fait ou un champ déjà disponible » → **fallback** comme prévu : barre entrée → prix au relevé, mention « Aucun stop détecté chez Tradovate ». À ouvrir en ticket séparé si Val pose bien des brackets : ajouter `order` + `orderVersion` à `LIVE_ENTITY_TYPES`, c'est le chemin le moins coûteux. **→ Fait dans #601 (2026-10-18)** : `order` + `orderVersion` souscrits, SL / TP reliés à la position (`tradovate-orders.ts`), repli conservé quand rien n'est lié avec certitude.

**Valeur du point** : `trades/instruments.const.ts:15-18` (MNQ 0,5/0,25 = 2 $/pt, NQ 20, MES 5, ES 50), exposée au front par `GET /instruments` (`core/api/trades.api.ts:6-10`, `:132`). Le front la calcule avec `tickValue / tickSize`.

## 3. Règles prop firm

Source unique : `GET /accounts` → `metrics` (`core/api/accounts.api.ts:82-125`), lu par `SelectedAccountStore`. `mtc-live-prop-firm` le consomme déjà (`live-prop-firm.component.ts:68-105`).

| Règle | Champ | Remarque |
|---|---|---|
| Plancher drawdown | `metrics.drawdown` : `floor`, `margin`, `pct`, `breached`, `rule.kind` (`static`/`trailing_eod`/`trailing_intraday`), `rule.peakBalance` | `accounts.api.ts:91-101`, `:10-29` |
| Perte max du jour | `metrics.dailyLoss` : `limit`, `used`, `remaining`, `pct` (= marge restante), `breach` | `accounts.api.ts:65-79`. **PREMIUM uniquement, gating côté API** (`.claude/agents/plans.md:215`) : `null` en FREE, avec un teaser (`live-prop-firm.component.html:84-107`) |
| Objectif de profit | `metrics.progress.requirements[profit\|cycle_profit]` sinon `metrics.objective` | `objectiveRatio`, `live-prop-firm.util.ts:40-45` |
| Equity / réalisé / latent | `metrics.broker` : `equity`, `cashBalance`, `openPnl`, `openPnlKnown` | `accounts.api.ts:112-122` |

Deux écarts avec le prompt, à trancher par Greg :
1. **Perte du jour en FREE** : le prompt dit « masquée si le plan n'a pas de perte journalière ». Aujourd'hui, elle est aussi masquée pour tout compte FREE. Je garde le gating Premium (source de vérité `plans.md`) et le teaser actuel, sauf contre-ordre.
2. **Seuils de couleur** : le prompt veut ambre ≥ 50 % consommé, rouge ≥ 80 %. `drawdownTone` (`live-prop-firm.util.ts:29-34`) passe au jaune à ≤ 50 % de marge restante (50 % consommé) et au rouge à ≤ 25 % restant (**75 %** consommé), pour avoir la même couleur que « Mes comptes » et le premier seuil d'alerte (#370). Je propose un utilitaire dédié à la jauge du jour, avec les seuils 50/80 du prompt, et de laisser `drawdownTone` intact pour le drawdown.

## 4. Limite de trades par jour

Elle existe : `User.tradesPerDayMin` / `tradesPerDayMax` (`prisma/schema.prisma:61-62`), saisie dans le profil (`features/profile/profile.component.ts:125-126`) et exposée au front (`core/auth/auth.service.ts:40-41`). Le bandeau affiche `Trades N / tradesPerDayMax`, ou `Trades N` si la valeur est nulle. N = `liveStats.tradesCount`.

## 5. État émotionnel

`TradeSession.moodStart` (`prisma/schema.prisma:296`), choisi en pré-session (`POST /session/start`, `session/session.service.ts:27-60`), et reçu par la vue via `session().moodStart`. Les libellés texte existent (`dashboard/dashboard-charts.util.ts:310` : confiant, concentré, neutre…). Le pipe `emotion-label` contient des emoji, donc il ne convient pas.

## 6. Chrono `265:58:47`

**Cause exacte : une session `ACTIVE` jamais clôturée, retrouvée sans borne de date.**
- `getActiveSession` (`session/session.service.ts:59-64`) prend la première session `ACTIVE` de l'utilisateur, **sans aucune limite de date**. `getTodaySession` (`:72-86`) la renvoie en priorité.
- Aucune clôture automatique : pas de cron sur `TradeSession`, et une nouvelle session ne ferme les anciennes qu'au démarrage suivant (`startSession`, `:27-31`).
- Le chrono (`core/stores/session.store.ts:75-85`) fait `now - startedAt` et ne plafonne pas les heures, d'où `265:…`. Le calcul est juste, c'est la session qui est vieille. `startedAt` n'est pas faux.
- Vérifié en base (lecture `mtc_readonly`, 2026-10-17) : en **prod**, une session `ACTIVE` d'un compte `ADMIN`, ouverte le **2026-10-06 18:40:26 UTC**, avec 0 trade. 18:40:26 + 265:58:47 = 2026-10-17 16:39 UTC, ça colle avec le retour. En **beta**, une session `ACTIVE` traîne depuis le 2026-09-30.
- Effet de bord : `getLiveStats` (`:311-327`) prend les trades **du jour**, alors que la session date d'il y a 11 jours. Le P&L du bandeau et le chrono ne parlent donc pas de la même période.

Correctif prévu (#595, front uniquement, conforme au prompt) : au-delà de 24 h, alerte « Session ouverte depuis le JJ/MM, clôture-la » + bouton de clôture, à la place du compteur. Format `HH:MM:SS` sinon. Une clôture automatique côté API (cron) reste une décision produit à part : pas dans cette passe.

## Notes pour l'implémentation

- Maquettes `docs/mockups/session-live-v3.html` et `-mobile.html` **absentes du dépôt** : à ajouter avant #596/#597.
- `session-live.component.css` : la vue existante suit une logique desktop-first. La refonte repart en mobile-first, sans `max-width`.
- Polling et synchro inchangés : tout ce qu'il faut est déjà dans `liveStats`, `accounts`, `ecoCalendar` et `user`. Aucun nouvel appel Tradovate.
