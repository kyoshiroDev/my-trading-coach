# PROMPT — #696 Gel du plancher au premier payout

## Texte de Greg (2026-11-23)

> relance le commit une fois cette feature fini enchaine sur les autres de la moin urgente a la plus urgente si tu as des question pose les au relecteur et suit ce qu'il te dit

Lecture du relecteur (consignée dans PROMPT-veille-regles-prop-firm.md) : après la veille, de la plus urgente à la moins urgente : #696, puis #825, puis #790 (#824 bloquée).

## Tâche

Issue #696 « Gel du plancher au premier payout » : modéliser la règle des firms qui figent le plancher du drawdown d'un compte funded dès le premier payout (demande ou approbation selon la firm), au lieu du seul franchissement du seuil de verrouillage. Périmètre décrit dans l'issue : champ structuré au schéma du catalogue, calcul du plancher (`drawdownFloor` / suivi du compte) figé au premier payout connu (détecté chez le broker ou saisi à la main), données des firms concernées (Lucid Flex, Top One, Tradeify, MyFundedFutures Pro), tests de cohérence, retrait de la note d'estimation posée par la PR #695.

## Arbitrages du relecteur (2026-11-23, validation du plan)

- Champ `max_drawdown.locks_on_first_payout` : `'request'` (demande), `'approval'` (payout approuvé), `'payout'` (source qui ne précise pas : Top One hors Elite Access Intraday). 92 phases (Lucid Flex 16, Top One 39, Tradeify 34 dont 8 c30, MFF Pro 3).
- Le gel ne fait jamais baisser le plancher : plancher figé = max(lockedFloor ?? locksAt − amount, plus haut avant le gel − amount).
- Payouts « probable » comptés ; `lastPayoutAt` pris en compte (premier payout = min des dates connues ≤ aujourd'hui).
- Plus de « Le plancher ne bouge pas. » quand le plan n'a pas le champ ; libellés par déclencheur ; note `request` « Ta firm fige le plancher dès ta demande de payout… ».
- Topstep XFA et FFF Premier+ : hors périmètre, issue de suivi.
- Une PR, commits par lot (shared, données par firm, API, app, références).
