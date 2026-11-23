# Courbe d'équité et plancher de drawdown

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Courbe d'équité journalière (`/analytics/equity-curve/daily`) · 2026-10-20 -->
> **Origine** : `nestjs.md` · « Courbe d'équité journalière (`/analytics/equity-curve/daily`) » · 2026-10-20

## Courbe d'équité journalière (`/analytics/equity-curve/daily`)

- Avec `from` : renvoie aussi `before = { pnl, peak }` (P&L net cumulé avant la période et son plus
  haut en clôture de journée, ≥ 0, fonction `periodBefore`). Le front ancre le drawdown sur ce sommet.
- `startingCapital` = `User.startingCapital` (profil), PAS le solde du compte : le front ne s'en sert
  plus pour placer la courbe. `summary.maxDrawdown` reste trade par trade (pic remis à 0 au début de
  la période) pour l'IA et les débriefs ; il n'est plus affiché comme « Drawdown max ».
- `payouts` (payouts `BrokerPayout` non écartés de la période, `{ date, amount }`) et
  `before.payouts` (total retiré avant `from`), fonction `splitPayouts`. Lus **hors cache** dans
  `getEquityCurveDaily` : une détection ou un « ce n'était pas un payout » se voit tout de suite, sans
  invalider le cache des trades. Le front les déduit des courbes de solde, jamais du P&L.

<!-- Origine : nestjs.md · Plancher de drawdown d'un plan (`drawdownFloor`, `@mtc/shared`) · 2026-10-20 -->
> **Origine** : `nestjs.md` · « Plancher de drawdown d'un plan (`drawdownFloor`, `@mtc/shared`) » · 2026-10-20

## Plancher de drawdown d'un plan (`drawdownFloor`, `@mtc/shared`)

Source unique du plancher : `accounts.service` (suivi du compte → Mes comptes, séance) et la courbe
de drawdown des Statistiques appellent `drawdownFloor(rule, peakProfit)`. Ne jamais recalculer un
plancher à la main ailleurs : modifier la règle (verrouillage, statique) dans cette fonction seulement.

Gel au premier payout (#696) : 3ᵉ argument `payoutFreezePeak` (plus haut retenu au moment du gel,
`null` = pas de payout). `rule.locksOnFirstPayout` vient de `planDrawdownRule`. Le seuil `locksAt`
atteint prime (`lockedBy: 'threshold'`). Côté API, le plus haut au jour du premier payout n'est pas
connu (pas d'historique jour par jour dans le suivi) : on passe le **plus haut actuel**, plancher au
moins aussi haut que la firm, donc prudent. La courbe de l'app (`floorSeries`) gèle, elle, avec le
plus haut à la date de `payoutLockedSince`.
