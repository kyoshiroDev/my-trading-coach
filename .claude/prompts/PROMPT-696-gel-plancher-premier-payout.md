# PROMPT — #696 Gel du plancher au premier payout

## Texte de Greg (2026-11-23)

> relance le commit une fois cette feature fini enchaine sur les autres de la moin urgente a la plus urgente si tu as des question pose les au relecteur et suit ce qu'il te dit

Lecture du relecteur (consignée dans PROMPT-veille-regles-prop-firm.md) : après la veille, de la plus urgente à la moins urgente : #696, puis #825, puis #790 (#824 bloquée).

## Tâche

Issue #696 « Gel du plancher au premier payout » : modéliser la règle des firms qui figent le plancher du drawdown d'un compte funded dès le premier payout (demande ou approbation selon la firm), au lieu du seul franchissement du seuil de verrouillage. Périmètre décrit dans l'issue : champ structuré au schéma du catalogue, calcul du plancher (`drawdownFloor` / suivi du compte) figé au premier payout connu (détecté chez le broker ou saisi à la main), données des firms concernées (Lucid Flex, Top One, Tradeify, MyFundedFutures Pro), tests de cohérence, retrait de la note d'estimation posée par la PR #695.
