# Audit — détecteurs de comportement (phase 1)

> Issue #602. Lecture du code de `beta` (`db199860`) et des bases prod / beta en lecture seule
> (`mtc_readonly`), le 2026-10-18. Aucun identifiant, e-mail ni nom dans ce document.

## Ce qui conditionne tout le reste

1. **Un `Trade` = une paire de fills, pas une position.** Une position de 20 MNQ entrée en
   plusieurs fois et sortie en plusieurs fois arrive en N lignes (souvent `quantity = 1`).
   Chez le trader le plus actif, taille médiane par ligne = 1, alors que ses positions vont jusqu'à
   20 contrats. Compter des lignes fausserait « trades par séance », « 3 pertes d'affilée » et la
   taille. → le moteur regroupe d'abord les lignes en **positions** (§ 1 bis).
2. **L'heure d'entrée n'est pas en base.** `tradedAt` = heure de **clôture** pour toute ligne
   importée (API, historique, CSV). Le délai de ré-entrée ne se mesure donc, sur l'historique,
   que de clôture à clôture. En direct, l'heure d'ouverture est connue (position Tradovate).
3. **« Séance » ≠ `TradeSession`.** Le trader le plus actif a 10 `TradeSession` pour 75 journées
   tradées : la plupart des trades synchronisés ne sont rattachés à aucune session. → une séance
   du moteur = **(compte, journée de trading CME)** (`tradingDay`, 17:00 CT).
4. **Presque aucun compte n'est relié à un plan du catalogue** (prod : 1 compte sur 16). Les
   détecteurs A (règles prop firm) n'ont rien à lire ailleurs : `TradingAccount` ne porte ni perte
   max du jour ni max de contrats saisis. Sans plan relié, A est muet (jamais de règle inventée).

## 1. Données par trade

| Donnée | Où | Fiabilité |
|---|---|---|
| Heure de sortie | `Trade.tradedAt` (`prisma/schema.prisma:207`) | Fiable, tronquée à la seconde (`tradovate-trade.mapper.ts:113`, `toSecond`) |
| Heure d'entrée | **absente** | Connue au mapping (`buy.timestamp` / `sell.timestamp`, `tradovate-trade.mapper.ts:107-112`) puis **jetée** : `resolvePairDirection` ne renvoie que la clôture (`trades/tradovate-pair.util.ts:22-31`). Idem historique (`tradovate-history.service.ts:216`, colonnes `boughtTimestamp`/`soldTimestamp` du rapport) et CSV (`csv-parsers.ts:184`) |
| Actif | `Trade.asset` (`schema.prisma:179`) | Symbole normalisé sans échéance (`normalizeFuturesSymbol`, `tradovate-pair.util.ts:14`) |
| Sens | `Trade.side` | Achat avant vente = LONG (`tradovate-pair.util.ts:28`) |
| Quantité | `Trade.quantity` (`schema.prisma:189`) | Quantité **de la paire** (`tradovate-trade.mapper.ts:123`). Nullable (saisie manuelle) |
| Prix | `Trade.entry` / `exit` | Prix de la paire (FIFO broker) |
| P&L net | `pnl` (brut) − `|commission|` → `netPnl` (`@mtc/shared`) | Frais par fill comptés une fois |
| Source | `Trade.source` (`schema.prisma:209`) | `MANUAL` / `CSV_IMPORT` / `BROKER_SYNC` / `BROKER_HISTORY` |
| Séance | `Trade.sessionId` (`schema.prisma:202`) | Rare sur les trades synchronisés (cf. point 3) |
| Compte | `Trade.accountId` | Posé par la synchro et l'import |

### 1 bis. Lignes → positions (choix du moteur)

Sur l'historique, une position est reconstituée ainsi (`behavior-positions.ts`) : on parcourt les
lignes d'un compte dans l'ordre de clôture, et une ligne **prolonge** la position précédente si elle
a le même actif et le même sens, et si **(a)** elle sort dans les 2 s de la précédente (une sortie
remplie en plusieurs fills) ou **(b)** elle partage un prix d'entrée avec la position (sortie
partielle de la même entrée). Sinon, c'est une nouvelle position.
- Taille d'une position = somme des quantités des lignes (contrats sortis). Elle sert à la
  référence personnelle et à B / C3 : le trader est comparé à lui-même avec la même mesure.
- Pour A1 (max du plan) sur l'historique, on prend la **borne basse** : la plus grosse sortie
  simultanée (lignes sorties dans la même fenêtre de 2 s). Jamais de faux dépassement.
- En direct, la taille vient de la position Tradovate (`netPos`), exacte.

Anomalie vue : une ligne de 145 MNQ pour 1,00 $ de P&L (prod, août) — incohérent avec
145 × 3,5 pts × 2 $. Probable fill cassé côté broker ; le moteur l'exclut de la référence
(quantité aberrante : au-delà de 10× le p90 du trader).

## 2. Position ouverte en direct

- `tradovate-open-positions.ts:11-20` : `{ asset, side, quantity, entryPrice (netPrice), since (timestamp) }`,
  écrite à chaque synchro dans Redis `tradovate:positions:<connexion>` (TTL 12 h,
  `tradovate-sync.service.ts:298`, `TradovateBalanceService.recordOpenPositionDetails`).
- Latent et equity du broker : `BrokerConnection.brokerOpenPnl` / `brokerNetLiq` (instantané de la synchro).
- Limite connue (inchangée) : relu seulement aux événements broker, pas de boucle sur les cotations.

## 3. Règles du plan prop firm

- Catalogue `libs/shared/src/prop-firm-rules/*.json`, miroir en base `PropFirmPlan.phases` (Json).
  490 phases : `max_contracts` présent partout (`{ minis, micros, scaling, tiers }`, 140 avec
  paliers selon le profit, `schema.json:195-215`) ; `daily_loss_limit` présent sur **170 / 490**
  (`amount`, `basis`, `tiers`, `scaling_rule`), le reste n'en a pas.
- Phase applicable : `phaseFor(plan, account.type)` (`accounts.service.ts:743`).
- Perte max du jour déjà calculée : `computeDailyLoss` (`accounts/daily-loss.ts:58`), exposée par
  `AccountsService.list(userId, { premium: true })` (référence = clôture officielle de la veille
  ou solde − P&L du jour). Le moteur la réutilise, rien n'est recalculé.
- **Équivalence micros** : aucune table n'existe. Le catalogue donne `minis` et `micros` séparément
  (10 micros = 1 mini pour toutes les firms relevées). Ajoutée dans `behavior.constants.ts`
  (`MICRO_TO_MINI`, MNQ/MES/MYM/M2K/MCL/MGC/M6E = 1/10).
- Comptes reliés à un plan (prod) : EVALUATION 1/9, FUNDED 0/2, PERSONAL 0/5. **Aucun compte du
  trader le plus actif.**

## 4. Valeur du point

`apps/api-mytradingcoach/src/modules/trades/instruments.const.ts:13-47` : `tickValue / tickSize`
(MNQ 2 $, NQ 20 $, MES 5 $, ES 50 $, MYM/YM, M2K/RTY, MCL/CL, MGC/GC, SIL/SI, taux, crypto CME,
devises). Complète pour les futures US vus en base (MNQ, NQ, MES, ES). Getters `getTickValue` /
`getTickSize` (`:57`, `:63`). La synchro préfère `product.valuePerPoint` de Tradovate
(`tradovate-trade.mapper.ts:85-95`) : même valeurs pour les 4 indices.

## 5. Profil

`User.tradesPerDayMax` (`schema.prisma:58-59`, saisi à l'onboarding / préférences,
`users.service.ts:476`) et `User.tradingStyle` (texte libre, `SCALPING` / `DAY_TRADING`…).
Valeurs prod : 100 pour le scalper, 5 et 3 ailleurs. C2 compte des **positions** (§ 1 bis),
pas des lignes. `tradingStyle` n'est pas utilisé par les détecteurs (on compare au trader, pas à une
étiquette) ; il reste un indice dans le rapport.

## 6. Volume d'historique (séances = compte × journée CME, comptes hors démo)

| Base | Trader | Lignes | Séances | Source |
|---|---|---|---|---|
| prod | A (scalper) | 948 | 75 (7 comptes) | broker |
| prod | B (bêta-testeur) | 122 | 39 | saisie |
| prod | C | 37 | 14 | saisie |
| prod | D | 70 | 7 | broker |
| beta | A' (même trader que A) | 977 | 65 | broker 629 |
| beta | C' (même trader que C) | 91 | 31 | saisie |

Comptes à ≥ 10 séances : A, B, C en prod. A et C existent aussi sur beta ; le rejeu porte sur la
prod (la plus complète).

## 7. Où brancher le calcul en direct

- Chaque événement du WebSocket Tradovate (fill, position) déclenche une synchro
  (`TradovateLiveService.syncAndNotify`, `tradovate-live.service.ts:186-201`), qui écrit les
  positions ouvertes dans Redis puis émet `tradovate:balance`. Le gateway
  (`tradovate-live.gateway.ts:47-62`) y branche déjà `PropAlertsService` sur le worker titulaire.
  → `BehaviorAlertsService.schedule` y est ajouté au même endroit (regroupement 1,5 s par compte).
- **Nouvelle entrée** = position absente au relevé précédent, ou quantité qui augmente (ajout).
  Le dernier état vu est gardé dans Redis (`behavior:pos:<compte>`). Aucun appel Tradovate en
  plus, aucune synchro relancée, aucun appel IA.
- Compteurs de séance (C2, C1) : positions clôturées du jour lues en base (index
  `Trade(accountId, tradedAt)`).
- Référence personnelle : recalculée par un cron à la bascule CME (17:10 CT, après
  `SessionCloseCron`) pour les utilisateurs qui ont tradé dans la journée, et à la volée si
  absente. Jamais à chaque événement.
- Limite : rien ne tourne app fermée (comme l'anti-tilt et les alertes prop firm).

## Recoupement avec l'existant

- `tilt-detection.ts` (#371, Premium, **affiché**) détecte déjà revenge (clôture < 2 min après une
  perte), taille > 2× médiane après une perte, surtrading. Il juge **une ligne** contre des seuils
  fixes : c'est exactement le risque « style pris pour du tilt » (un scalper déclenche revenge à
  chaque perte). Le moteur de phase 1 ne le touche pas ; s'il est validé, l'UI phase 2 devra le
  remplacer, pas s'y ajouter (deux alertes pour le même fait).
- `PropRiskEvent` journalise les alertes prop firm et le tilt : `BehaviorAlert` est une table à
  part (types et cycle de vie différents : `dismissedAt`, `mutedByUser`).

## Décisions à valider

1. Ajouter `Trade.openedAt` (colonne nullable, posée par la synchro / l'historique / le CSV, qui
   ont déjà l'heure) : délai de ré-entrée exact sur l'historique futur. Non fait en phase 1.
2. Pousser le rattachement des comptes au catalogue : sans plan relié, A ne se déclenche jamais.
