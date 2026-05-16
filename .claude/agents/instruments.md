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

## Modes de calcul — `calculationMode`

| Mode | Condition | Formule |
|------|-----------|---------|
| `futures` | `category === 'FUTURES_US'` | `(rawPoints / tickSize) × tickValue × qty` |
| `forex` | `category === 'FOREX'` | `(rawPoints / pipSize) × tickValue × qty` où `pipSize = 10^-pipDecimals` |
| `crypto-spot` | `category === 'CRYPTO'`, levier = 1 | `variation% × capital` |
| `crypto-leverage` | `category === 'CRYPTO'`, levier > 1 | `variation% × capital × levier` |
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
