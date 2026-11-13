---
name: instruments
description: "Calcul du P&L par instrument (futures, forex, crypto) : ticks, multiplicateurs, frais. À lire avant de toucher aux calculs de trades ou aux instruments."
---

# Agent Instruments — Calcul P&L Futures, Forex, Crypto

## Source de vérité

`apps/api-mytradingcoach/src/modules/trades/instruments.const.ts`

---

## Interface

```typescript
export interface Instrument {
  symbol: string;
  label: string;
  category: 'FUTURES_US' | 'CRYPTO' | 'FOREX' | 'INDICES' | 'ACTIONS';
  tickValue: number | null;   // valeur monétaire par tick ($)
  tickSize?: number;          // taille d'un tick en unités de prix
  pipDecimals?: number;       // FOREX uniquement
}
```

---

## Formule P&L

```
rawPoints = isLong ? exit - entry : entry - exit
ticks     = rawPoints / tickSize
pnl       = ticks × tickValue × qty
```

---

## Drawdown max PAR COMPTE et écart Capital / P&L (PROMPT-drawdown-max-par-compte, 2026-11-11)
- Drawdown max : une série par compte (`worstAccountDrawdown`, `@mtc/shared`), le pire gardé en vue
  « Tous les comptes ». Les règles des prop firms s'appliquent compte par compte : jamais une série
  qui additionne plusieurs comptes.
- « Capital » affiché = solde du compte (`currentBalance`) : celui du BROKER pour un compte connecté.
  « P&L net » = somme des trades clôturés de la PÉRIODE. Sans broker, solde = départ + Σ nets − payouts
  saisis, au centime près (aucun écart d'arrondi possible). Un écart « départ + P&L ≠ Capital » vient
  donc du solde broker (frais d'entrée d'une position encore ouverte, frais absents des trades MTC,
  payouts) ou de trades hors période ; jamais d'un arrondi.
- « P&L cumulé » de Mes comptes = `metrics.tradingPnl` = solde − départ + TOUS les payouts (#947) : un
  retrait n'est pas une perte. `realizedPnl` (solde − départ) reste la base de l'objectif et du cycle
  de payout ; ne jamais l'afficher comme P&L.

## Convention P&L unique — brut stocké, net calculé (PROMPT-213)
`Trade.pnl` est TOUJOURS le P&L **BRUT** (résultat des prix) ; les frais vivent dans `commission`
(positive). Le **net** = `pnl − |commission|` n'est jamais stocké : il est calculé à la lecture par
`netPnl()` de `@mtc/shared`, et **tout** montant affiché (KPI, calendrier, courbe d'équité, drawdown,
top actifs, setups, heatmap, débrief, récap IA) comme **tout** classement gagnant/perdant (win rate,
série, W/L par groupe) passe par ce net : un trade à +1 $ brut avec 1,90 $ de frais est une perte.
Toute requête qui calcule sur `pnl` sélectionne donc aussi `commission`. Avant PROMPT-213, la saisie
manuelle stockait un net (le formulaire envoyait `pnlNet`, `calculatePnl` retirait encore les frais)
tandis que les imports stockaient du brut, et chaque écran choisissait brut ou net : sur le compte
de Val, Analytics affichait −41,10 $ et le calendrier +24 $ pour la même journée.
Même piège au niveau d'**une ligne** (corrigé le 2026-09-30) : la ligne du journal affichait
`trade.pnl` brut sous un en-tête « résultat net » et sous des totaux jour/semaine nets ; les cartes
meilleur/pire trade et la règle « pertes max » de la session du jour classaient aussi sur le brut.
Dans un template : `@let net = netPnl(trade)` (exposer `protected readonly netPnl = netPnl`), jamais
`trade.pnl | pnlFormat`. Verrouillé par `journal-row-net.spec.ts`, qui rend le vrai template.

## Devise des montants — celle du compte, jamais convertie (PROMPT-214)
Un P&L est exprimé dans la devise de son compte de trading (`TradingAccount.currency`) : un contrat
MNQ sur un compte prop firm USD donne des USD, affichés en USD pour tout le monde. Aucun taux de
change n'est appliqué nulle part (l'ancien `User.currencyRate` a été retiré). Les calculs de P&L
(ticks × tickValue, P&L réalisé du broker) ne connaissent pas la devise d'affichage ; seul le
formateur `formatMoney` de `@mtc/shared` y ajoute le symbole du compte.

## Règle P&L absolue — le réalisé prime sur le recalcul
Si un `pnl` réalisé est fourni (import broker, ou édition sans changement de prix/qty), il fait FOI :
`calculatePnl` retourne `dto.pnl` (brut, arrondi au centime) AVANT tout recalcul `points × qty`.
On ne recalcule (points × tickValue × qty) que si AUCUN pnl n'est fourni.
`update()` ne recalcule le pnl QUE si un champ de prix change (entry/exit/quantity/commission/pnl).
Sans `pnl` envoyé, un changement RÉEL d'entrée / sortie / quantité / sens / capital (comparé à la base :
le front renvoie le DTO complet) recalcule le P&L depuis les prix (#947), seulement si la valeur du tick
est connue ou le capital engagé renseigné, et jamais sur un trade importé (`importHash`) : sinon le
P&L réalisé est gardé.

⚠️ Crypto / MEXC : la quantité importée est en CONTRATS (« Closing Qty (Cont.) »), pas en coins
(1 contrat BTC = 0.0001 BTC). Un recalcul `points × quantité(contrats)` gonfle le P&L d'un facteur =
taille du contrat (×10000 sur BTC). D'où la priorité au pnl réalisé du fichier. Ne jamais réintroduire
un recalcul qui écrase un pnl réalisé fourni.
⚠️ MEXC « Realized PNL » est NET des frais (brut − Trading Fee). Le parseur (`parseMexc`) stocke le
BRUT = `roundCents(realized) + roundCents(|fee|)` et les frais dans `commission` : le net affiché
(`netPnl`) redonne exactement le Realized PNL arrondi. Stocker le net tel quel retirait les frais une
2ᵉ fois (#947 : −6,57 $ affiché −8,19 $).

## Pourcentage affiché à côté d'un P&L — variation du prix, jamais P&L / prix
Le `%` des lignes du journal est `priceMovePct` (`@mtc/shared`) : `(exit − entry) / entry × 100`,
signe inversé pour un SHORT. Jamais `pnl / entry` : c'est diviser des dollars par un prix, résultat
sans unité et faux partout (EUR/USD, entrée ≈ 1,08 : +30 $ affichait **+2764 %** ; MNQ affichait
un chiffre plausible mais tout aussi faux). Le pipe `pnlFormat` prend le trade
(`{{ t.pnl | pnlFormat : t : t.accountId }}`), pas le prix d'entrée.

---

## Modes de calcul — `calculationMode`

| Mode | Condition | Formule |
|------|-----------|---------|
| `futures` | `category === 'FUTURES_US'` | `(rawPoints / tickSize) × tickValue × qty` |
| `forex` | `category === 'FOREX'` | `(rawPoints / pipSize) × tickValue × qty` où `pipSize = 10^-pipDecimals` |

**Forex en saisie manuelle (#951, décision du 13/11).** Seules les paires **cotées en dollars** sont au
catalogue (`GET /instruments`) : EUR/USD, GBP/USD, AUD/USD, NZD/USD, `tickSize = 0,0001` (1 pip),
`tickValue = 10 $` (1 pip × 1 lot standard de 100 000), quantité = lots. Le back (`calculatePnl`), le
formulaire et le risque du stop (`stopRiskAmount`) passent par la formule générique ticks × valeur :
EUR/USD 1,0800 → 1,0850, 1 lot = +500 $. Les autres paires (USD/JPY, EUR/GBP…, `isNonUsdQuotedForex`
de `@mtc/shared`) donneraient un P&L en devise de cotation, sans taux de change dans l'app
(PROMPT-214) : jamais `points × quantité` (le back renvoie « P&L inconnu »), le P&L passe par le
capital engagé (variation × capital), exigé par le formulaire. Aucune conversion de devise nulle part.
| `crypto-spot` | `CRYPTO`, levier = 1 | capital > 0 → `variation% × capital` ; sinon back : `points × quantity` |
| `crypto-leverage` | `CRYPTO`, levier > 1 | `variation% × capital × levier` |
| `null` (CFD/Actions) | `tickValue === null` | `variation% × capital` |

---

## Référence tickSize officielle CME

| Groupe | Symboles | tickSize | tickValue |
|--------|----------|----------|-----------|
| S&P | MES / ES | 0.25 | $1.25 / $12.50 |
| Nasdaq | MNQ / NQ | 0.25 | $0.50 / $5.00 |
| Dow | MYM / YM | 1.0 | $0.50 / $5.00 |
| Russell | M2K / RTY | 0.10 | $0.50 / $5.00 |
| Crude Oil | MCL / CL | 0.01 | $1.00 / $10.00 |
| E-mini Crude Oil | QM | 0.025 | $12.50 |
| Natural Gas | NG / QG (E-mini) | 0.001 / 0.005 | $10.00 / $12.50 |
| Copper | HG | 0.0005 | $12.50 |
| Gold | MGC / GC | 0.10 | $1.00 / $10.00 |
| Silver | SIL / SI | 0.005 | $5.00 / $25.00 |
| Euro FX | M6E / 6E | 0.0001 / 0.00005 | $1.25 / $6.25 |
| GBP | 6B | 0.0001 | $6.25 |
| AUD / CAD | 6A / 6C | 0.00005 | $5.00 |
| CHF | 6S | 0.00005 | $6.25 |
| JPY | 6J | 0.0000005 | $6.25 |
| Micro Bitcoin | MBT | 5.0 | $0.50 |
| Bitcoin | BTC | 5.0 | $25.00 |
| Micro Ether / Ether | MET / ETH | 0.50 | $0.05 / $25.00 |
| T-Note 2Y | ZT | 0.00390625 | $7.8125 |
| T-Note 5Y | ZF | 0.0078125 | $7.8125 |
| T-Note 10Y | ZN | 0.015625 | $15.625 |
| T-Bond 30Y | ZB | 0.03125 | $31.25 |

---

## Vérification calcul — cas tests

```
MES LONG entry:5200 exit:5204 qty:1
→ ticks = (5204-5200)/0.25 = 16
→ pnl = 16 × $1.25 = $20 ✓

6E LONG entry:1.17225 exit:1.1729 qty:1
→ ticks = (1.1729-1.17225)/0.00005 = 13
→ pnl = 13 × $6.25 = $81.25 ✓

CL LONG entry:80.00 exit:80.10 qty:1
→ ticks = (80.10-80.00)/0.01 = 10
→ pnl = 10 × $10.00 = $100 ✓

ES SHORT entry:5200 exit:5202 qty:2
→ ticks = (5200-5202)/0.25 = -8
→ pnl = -8 × $12.50 × 2 = -$200 ✓
```

---

## Règle ajout instrument

Avant d'ajouter un instrument, vérifier les specs officielles :
- CME Group : https://www.cmegroup.com/markets/
- Toujours spécifier `tickSize` ET `tickValue`
- Ne jamais mettre `tickValue` = valeur par point entier si `tickSize ≠ 1`
- Le `tickValue` est la valeur monétaire d'UN tick, pas d'un point entier

## Import Tradovate — frais exacts par trade (fusion Performance + Cash history)

Deux fichiers optionnellement fusionnés à l'import (`csv-import.service.ts`) pour obtenir la
commission **exacte au centime par trade**, sans saisie manuelle ni limite de nombre de trades :
- **Performance** (les trades) : header `symbol,…,buyFillId,sellFillId,qty,…`. On capture
  `buyFillId`/`sellFillId` **par nom de colonne** (portés en métadonnée interne `_buyFillId`/
  `_sellFillId`, retirés avant persistance).
- **Cash history** (les frais) : header `Account,Transaction ID,…,Delta,Amount,Cash Change Type,…`.
  **Tous les frais** comptent (#783) : `Cash Change Type` (trim) `Commission` ou `… Fee`
  (Exchange, Clearing, Nfa, Brokerage, Routing… : `isTradovateFeeType`). Sur ES le 27/10 :
  2,18 $ par côté-contrat dont 0,59 $ de commission seulement. Le montant est **`Delta`** (abs).
  `Amount` = solde courant → **ignoré**. `Trade Paired`, `Fund Transaction`, payouts → ignorés.

**Jointure (`cashHistoryFeesByFill`, `tradovate-fees.util.ts`)** : une ligne de frais appartient au
fill de **même `Timestamp` (à la seconde) et même contrat** dont l'id est le plus grand sous son
`Transaction ID` (fills et trésorerie partagent une même suite d'ids : fill …007, frais …008-011).
Les fills viennent de l'export Performance brut (`buyFillId`+`boughtTimestamp`, `sellFillId`+
`soldTimestamp`, `symbol`). L'ancienne règle `fillId = Transaction ID − 1` est FAUSSE (décalage
variable : 0/30 sur l'export réel du 27/10). Une ligne sans fill du lot reste **orpheline** (jamais
posée sur un autre fill) → checksum en écart. Fixtures réelles : `__fixtures__/tradovate-fees-2026-10-27-*`.

**Dédup obligatoire (scalping)** : un même `fillId` peut clôturer un trade ET en ouvrir un autre.
Sa commission ne compte qu'**une fois** sur tout l'import (sinon double comptage : données de Val,
naïf 24,96 $ vs exact 21,84 $). Elle est **répartie au prorata de la quantité** entre les trades du lot
qui utilisent ce fill (`assignFeesOncePerFill`, #947), au centime, le dernier trade prend le reste.
Ne jamais revenir à « tout au premier trade, 0 aux suivants » : total juste mais net par trade faux
(achat 2 ES vendu en 2 fois : 6,54 $ / 2,18 $ au lieu de 4,36 $ / 4,36 $, un trade perdant affiché gagnant).
La réparation des frais #783 (`planFeeRepairs`) traite les trades reliés par un fill commun **en
groupe** (#950) : en base, l'ancienne règle a tout posé sur le premier ; ne monter que les suivants
compterait le fill deux fois. Chaque trade du groupe prend sa part recalculée (un trade peut baisser,
`redistributed`), le **total du groupe ne baisse jamais** ; groupe incomplet (trade absent, frais
indisponibles) ou total plus élevé en base (frais saisis à la main) → ignoré (`skippedShared`).

**Positions (#956)** : les frais sont d'abord posés **par paire** (règle ci-dessus), puis
**additionnés** dans le trade de la position (`aggregateGroup`). Le rapport de frais (`FeesReport.count`,
« Frais importés : … sur N trade(s) ») compte les trades créés, donc les positions. La réparation des frais #783 compare des trades par paire : un trade de
position (`importHash` `tv:…`) n'y est jamais retrouvé (`notFound`), donc jamais modifié.

**Script #950** (`scripts/repair-chiffres-950.ts`, règles dans `trades/repair-950.util.ts`) : répare
en prod les données faussées avant l'audit #947 : MEXC stocké au P&L net (signature : frais avec des
fractions de centime, symbole `…USDT`/`…USDC`/`X/USD` même exotique, import d'avant `LOT1_EN_PROD`),
clôture en séance stockée en écart de prix (créée avant `LOT1_EN_PROD`),
totaux de séances clôturées figés. Simulation par défaut, `--apply --backup`. Les fills partagés
Tradovate passent par la réparation des frais de l'admin, AVANT le script (elle ne touche que
`commission` ; le script recalcule ensuite séances, récaps et barèmes).

**Checksum** : `Σ commission(trade) == Σ |Delta| des frais` (à 0,01 près) → `reconciled`. En cas
d'écart : warning + `reconciled=false` (non bloquant, « frais partiellement rapprochés »), jamais de
crash.

**Périmètre** : fusion appliquée UNIQUEMENT si le fichier des trades est un **Tradovate Performance**
ET qu'un **Cash history valide** est fourni (`fees`). Sinon → comportement inchangé (colonne
commission du CSV si présente, sinon `totalFees` manuel réparti au prorata). La commission posée est
**positive** ; le `pnl` reste brut et le net est calculé à la lecture (`netPnl`, cf. convention P&L).

**Endpoint** : `POST /trades/import` accepte deux champs multipart via `FileFieldsInterceptor` —
`file` (trades, obligatoire, nom conservé pour rétro-compat) + `fees` (Cash history, optionnel).
Le résumé (`feesImported: { assigned, expected, reconciled, count }`) est renvoyé au front.

**Front** : `mtc-csv-import` (composant unique réutilisé journal + dashboard + **onboarding**) porte un
input `allowFeesFile` (défaut `true`). L'onboarding passe `[allowFeesFile]="false"` → un seul fichier,
zéro friction. Fixtures de test : `__fixtures__/tradovate-performance.csv` + `tradovate-cash-history.csv`.

## P&L des trades synchronisés Tradovate (PROMPT-207)

`(prix de vente − prix d'achat) × qty × valuePerPoint`, **brut**, arrondi au centime — identique
à la colonne `pnl` de l'export Performance. `valuePerPoint` vient du `product` Tradovate ; repli
sur `tickValue / tickSize` de `instruments.const.ts` (MNQ : 0,5 / 0,25 = 2 $/pt). Paire ignorée
(et comptée dans `skipped`) si ni l'un ni l'autre n'est connu : jamais de P&L inventé.
Symbole normalisé par `normalizeFuturesSymbol` (MNQU6 → MNQ), partagé avec l'import CSV.
