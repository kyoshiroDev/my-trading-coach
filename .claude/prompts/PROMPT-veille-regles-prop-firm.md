enchaine la suite dans l'ordre de tespriorité

---
Contexte (ajouté par la session, 22/11) : tri d'urgence des idées fait juste avant (« verifie dans idées feature s certainies serais urgente ») : 1) #765 bundle (PR #1216), 2) veille des règles prop firm (#858, #653), 3) #696 gel du plancher au premier payout, 4) #825 export des données, 5) #790 journaux de facturation, 6) #824 purge (bloqué, juriste).

Découpage validé par le relecteur (22/11), un lot = une PR, tri par ancienneté de `verified_at` :
- lot 1 : Phidias, OneUp Trader, Bulenox (pages Funded et Qualification « contenu modifié ») ;
- lot 2 : Earn2Trade, Elite, Take Profit Trader (vérifier le seed démo Elite 25K, 18 %) ;
- lot 3 : Apex et Lucid (vérifier le seed démo Apex) ;
- lot 4 : MyFundedFutures, Tradeify (vérifier le seed démo Tradeify) ;
- lot 5 : BluSky, FFF, Topstep, TradeDay, Top One, UProfit (relever leur `verified_at`).
Règles : Chrome sur les pages publiques seulement, jamais de connexion à un compte de firme ; `pnpm prop-firms:watch --update` en ne gardant dans `veille/sources.json` que les URL du lot ; plan plus vendu → `discontinued` (jamais retiré) ; règle ambiguë ou montant non publié → `needs_review` / DLL `amount: null`, jamais de valeur devinée ; tableau des changements dans la PR (plan, champ, avant → après, source, date), en tête ce qui modifie une marge affichée. Vérificateurs : nestjs, instruments, tests, angular, puis relecteur ; build landing en local (pages SEO des règles).

---

## Complément de Greg (2026-11-23)

> relance le commit une fois cette feature fini enchaine sur les autres de la moin urgente a la plus urgente si tu as des question pose les au relecteur et suit ce qu'il te dit

Lecture du relecteur : « cette feature » = toute la veille (lots 3, 4 puis 5), ensuite de la plus urgente à la moins urgente : #696, #825, #790 (#824 bloquée).
