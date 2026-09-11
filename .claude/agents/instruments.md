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

## Règle P&L absolue — le réalisé prime sur le recalcul
Si un `pnl` réalisé est fourni (import broker, ou édition sans changement de prix/qty), il fait FOI :
`calculatePnl` retourne `dto.pnl - commission` AVANT tout recalcul `points × qty`.
On ne recalcule (points × tickValue × qty) que si AUCUN pnl n'est fourni.
`update()` ne recalcule le pnl QUE si un champ de prix change (entry/exit/quantity/commission/pnl).

⚠️ Crypto / MEXC : la quantité importée est en CONTRATS (« Closing Qty (Cont.) »), pas en coins
(1 contrat BTC = 0.0001 BTC). Un recalcul `points × quantité(contrats)` gonfle le P&L d'un facteur =
taille du contrat (×10000 sur BTC). D'où la priorité au pnl réalisé du fichier. Ne jamais réintroduire
un recalcul qui écrase un pnl réalisé fourni.

---

## Modes de calcul — `calculationMode`

| Mode | Condition | Formule |
|------|-----------|---------|
| `futures` | `category === 'FUTURES_US'` | `(rawPoints / tickSize) × tickValue × qty` |
| `forex` | `category === 'FOREX'` | `(rawPoints / pipSize) × tickValue × qty` où `pipSize = 10^-pipDecimals` |
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
| Gold | MGC / GC | 0.10 | $1.00 / $10.00 |
| Silver | SIL / SI | 0.005 | $1.25 / $25.00 |
| Euro FX | M6E / 6E | 0.0001 / 0.00005 | $1.25 / $6.25 |
| GBP | M6B / 6B | 0.0001 | $0.625 / $6.25 |
| JPY | 6J | 0.0000005 | $6.25 |
| Micro Bitcoin | MBT | 5.0 | $5.00 |
| Bitcoin | BTC | 5.0 | $25.00 |
| Micro Ether | MET | 0.10 | $0.10 |
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
  Seules les lignes `Cash Change Type` (trim) == `Commission` comptent ; le montant est **`Delta`**
  (négatif → on prend `abs`). `Amount` = solde courant → **ignoré**. Lignes `Trade Paired` → ignorées.

**Jointure (validée sur données réelles)** : `fillId = (Transaction ID) − 1`, une entrée par fill →
`commissionParFill[fillId] = |Delta|`.

**Dédup obligatoire (scalping)** : un même `fillId` peut clôturer un trade ET en ouvrir un autre.
Sa commission ne compte qu'**une fois** sur tout l'import. On parcourt les trades **dans l'ordre du
fichier** avec un `Set<fillId>` consommés ; un fill n'ajoute sa commission que s'il n'a pas déjà été
consommé, puis on le marque. Sinon double comptage (ex. données de Val : naïf 24,96 $ vs exact 21,84 $,
soit +3,12 $ de 3 fills partagés comptés deux fois).

**Checksum** : `Σ commission(trade) == Σ |Delta| Commission` (à 0,01 près) → `reconciled`. En cas
d'écart : warning + `reconciled=false` (non bloquant, « frais partiellement rapprochés »), jamais de
crash.

**Périmètre** : fusion appliquée UNIQUEMENT si le fichier des trades est un **Tradovate Performance**
ET qu'un **Cash history valide** est fourni (`fees`). Sinon → comportement inchangé (colonne
commission du CSV si présente, sinon `totalFees` manuel réparti au prorata). La commission posée est
**positive** ; `calculatePnl` déduit `commission` du P&L net.

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
