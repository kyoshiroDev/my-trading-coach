# Rapport d'extraction : règles prop firm (PROMPT-136)

**Mise à jour du 2026-10-03** : ajout de Topstep, Tradeify, MyFundedFutures et TradeDay (62 plans), voir la section « Quatre firms ajoutées » en fin de rapport. Catalogue : 6 firms, 116 plans.

Relevé du 2026-10-02. Sources : sites et help centers officiels uniquement. Issue GitHub : #267.

**Re-vérification complète du 2026-10-02 (soir)** : voir la section « Re-vérification » en fin de rapport (3 corrections Lucid, Apex conforme, offre Legacy Apex revenue en vente et non couverte).

**À lire en premier** : tous les plans Lucid sont en `needs_review`, pour trois questions transverses qu'une seule question au support Lucid peut trancher (voir « Plans à revoir »). Les 8 plans Apex sont complets.

## Résumé

| Firm | Programmes en vente | Tailles | Plans dans le catalogue | `needs_review` |
|---|---|---|---|---|
| Lucid Trading | LucidFlex, LucidPro, LucidDaily, LucidDirect, LucidMaxx (sur invitation) | 25K, 50K, 100K, 150K | 40 | 40 |
| Apex Trader Funding | Intraday Trail, EOD Trail, Legacy Full (promotion limitée) | 25K, 50K, 100K, 150K (+ 250K, 300K en Legacy) | 14 | 6 |

Apex : 8 plans de la gamme actuelle (complets) + 6 plans **Legacy Full** (25K à 300K), revenus en vente en promotion limitée, tous en `needs_review`.

Pourquoi 40 plans Lucid : les options choisies au checkout changent les règles, donc chaque combinaison est un plan.
- LucidFlex et LucidPro : DLL ON ou OFF (2 x 4 tailles chacun).
- LucidDaily : DLL ON ou OFF x drawdown d'évaluation EOD ou intraday (4 x 4 tailles).
- LucidDirect et LucidMaxx : sans option (4 tailles chacun).

Exclus volontairement :
- **LucidBlack** : collection « Legacy » du help center, plus en vente.
- **Comptes live Lucid** (LucidLive) : on n'y entre pas par achat, Lucid y fait passer les traders (après le payout 5 ou sur décision de l'équipe risque). Règles notées dans `notes` ; à modéliser si MTC suit ces comptes.
- **Apex Legacy Static (100K) et Legacy 75K** : produits Legacy qui ne sont pas dans l'offre promotionnelle en cours (seuls les 6 « Full » 25K à 300K le sont). Non couverts.
- **Apex « No Activation Fee »** : mêmes règles que l'offre Standard, seul le prix change. Noté dans `price.notes`, pas de plan séparé.

## Sources consultées

### Lucid Trading

Site : https://lucidtrading.com (sélecteur de plans de la page d'accueil, lu dans Chrome car le site renvoie 403 aux requêtes directes). Help center : https://support.lucidtrading.com/en/ (Intercom ; date = `dateModified` de l'article).

| Mis à jour | Article (https://support.lucidtrading.com/en/articles/...) |
|---|---|
| 2026-07-28 | 11404614-lucid-trading-supported-platforms |
| 2026-08-26 | 11404729-allowed-trading-times |
| 2026-08-26 | 11404728-other-trading-activities |
| 2026-08-26 | 11404617-maximum-number-of-accounts |
| 2026-08-26 | 11404620-simulated-account-fees |
| 2026-08-31 | 12945790-lucidflex-evaluation-account |
| 2026-08-15 | 12945795-lucidflex-funded-account |
| 2026-07-28 | 12945796-lucidflex-payouts |
| 2026-08-26 | 12945805-lucidflex-consistency-percentage |
| 2026-05-06 | 12945808-lucidflex-scaling-plan |
| 2026-08-26 | 12945815-lucidflex-drawdown |
| 2026-08-06 | 16226050-lucidflex-customization |
| 2026-08-26 | 12890029-lucidpro-evaluation-account |
| 2026-08-26 | 12890069-lucidpro-funded-account |
| 2026-08-06 | 12890092-lucidpro-payouts |
| 2026-08-26 | 12890109-lucidpro-consistency-percentage |
| 2026-07-26 | 12890122-lucidpro-daily-loss-limit |
| 2026-08-26 | 12890136-lucidpro-drawdown |
| 2026-08-06 | 16226068-lucidpro-customization |
| 2026-07-31 | 15996664-luciddaily-evaluation |
| 2026-08-07 | 15997244-luciddaily-funded-account |
| 2026-07-27 | 15997266-luciddaily-payouts |
| 2026-07-27 | 15998336-luciddaily-consistency |
| 2026-07-27 | 15998425-luciddaily-drawdown |
| 2026-07-27 | 16010520-luciddaily-live |
| 2026-07-27 | 16033858-luciddaily-customization |
| 2026-08-19 | 16085900-luciddaily-daily-loss-limit |
| 2026-08-26 | 12890148-luciddirect-funded-account |
| 2026-08-26 | 12890164-luciddirect-payout-objectives |
| 2026-08-26 | 12890178-luciddirect-consistency-percentage |
| 2026-08-26 | 12890185-luciddirect-daily-loss-limit |
| 2026-08-26 | 12890192-luciddirect-drawdown |
| 2026-06-29 | 13891785-lucidmaxx-overview |
| 2026-08-26 | 14315460-lucidmaxx-eval-rules |
| 2026-08-26 | 14315468-lucidmaxx-cooldown |
| 2026-08-26 | 14316866-lucidmaxx-eval-pricing |
| 2026-09-23 | 13425130-new-live-structure |

Les 59 articles du help center ont été récupérés. Ceux qui ne sont pas listés n'ont pas servi : LucidBlack et Live Legacy (hors vente), paiements, pays restreints, mission, et les pages de conduite (hedging, HFT, microscalping, intégrité, produits autorisés et commissions) qui n'ont pas été relues ligne à ligne.

### Apex Trader Funding

Site : https://apextraderfunding.com (sélecteur de produits de la page d'accueil, lu dans Chrome car le site renvoie 403 aux requêtes directes). Help center : https://apextraderfunding.com/help-center/ (WordPress, liste complète dans `help-center-sitemap.xml`). L'ancien help center `support.apextraderfunding.com` (Zendesk) redirige désormais vers celui-ci : pas de seconde source à réconcilier.

| Mis à jour | Article (https://apextraderfunding.com/help-center/...) |
|---|---|
| 2026-04-28 | evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/ |
| 2026-04-28 | intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/ |
| 2026-05-21 | intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-performance-accounts-pa/ |
| 2026-04-28 | intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-payouts/ |
| 2026-06-05 | eod-trailing-drawdown-accounts/eod-evaluations/ |
| 2026-04-28 | eod-trailing-drawdown-accounts/eod-drawdown-explained/ |
| 2026-04-28 | eod-trailing-drawdown-accounts/eod-performance-accounts-pa/ |
| 2026-04-28 | eod-trailing-drawdown-accounts/eod-payouts/ |
| 2026-04-15 | additional-helpful-items/daily-loss-limit-explained/ |
| 2026-04-16 | additional-helpful-items/scaling-levels-pa-explained/ |
| 2026-04-15 | additional-helpful-items/position-sizing-evaluation/ |
| 2026-04-24 | additional-helpful-items/50-consistency-requirement/ |
| 2026-04-15 | additional-helpful-items/new-products/ |
| 2026-06-25 | billing/evaluation-plan-fees-and-access-explained/ |
| 2026-06-05 | uncategorized/no-activation-fee-evaluations/ |
| 2026-09-11 | billing/inactivity-policy-on-performance-accounts-pa/ |
| 2026-04-20 | getting-started/futures-trading-times/ |
| 2026-07-31 | getting-started/prohibited-activities/ |
| 2026-04-16 | getting-started/choosing-the-right-platform/ |
| 2026-07-21 | legacy-products/legacy-products-overview/ |

## Tableau récap par plan

Seuil figé : « solde déclencheur (niveau du seuil une fois figé) ». DD journalier « aucun » = pas de DLL ; « ? » = la DLL existe mais le montant n'est pas publié.

### Lucid Trading

| Plan | Phase | Objectif | DD journalier | DD max | Type DD | Figé à (seuil) | Consistency | À revoir |
|---|---|---|---|---|---|---|---|---|
| `lucid-flex-25k` | éval | 1 250 $ | aucun | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 50 % (objectif) | oui |
| `lucid-flex-25k` | funded | aucun | aucun | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-flex-50k` | éval | 3 000 $ | aucun | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 50 % (objectif) | oui |
| `lucid-flex-50k` | funded | aucun | aucun | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-flex-100k` | éval | 6 000 $ | aucun | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 50 % (objectif) | oui |
| `lucid-flex-100k` | funded | aucun | aucun | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-flex-150k` | éval | 9 000 $ | aucun | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | 50 % (objectif) | oui |
| `lucid-flex-150k` | funded | aucun | aucun | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-flex-dll-25k` | éval | 1 250 $ | 600 $ | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 50 % (objectif) | oui |
| `lucid-flex-dll-25k` | funded | aucun | ? | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-flex-dll-50k` | éval | 3 000 $ | 1 200 $ | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 50 % (objectif) | oui |
| `lucid-flex-dll-50k` | funded | aucun | ? | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-flex-dll-100k` | éval | 6 000 $ | 1 800 $ | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 50 % (objectif) | oui |
| `lucid-flex-dll-100k` | funded | aucun | ? | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-flex-dll-150k` | éval | 9 000 $ | 2 700 $ | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | 50 % (objectif) | oui |
| `lucid-flex-dll-150k` | funded | aucun | ? | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-pro-25k` | éval | 1 250 $ | aucun | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-pro-25k` | funded | aucun | aucun | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 40 % (payout) | oui |
| `lucid-pro-50k` | éval | 3 000 $ | aucun | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-pro-50k` | funded | aucun | aucun | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 40 % (payout) | oui |
| `lucid-pro-100k` | éval | 6 000 $ | aucun | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-pro-100k` | funded | aucun | aucun | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 40 % (payout) | oui |
| `lucid-pro-150k` | éval | 9 000 $ | aucun | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-pro-150k` | funded | aucun | aucun | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | 40 % (payout) | oui |
| `lucid-pro-dll-25k` | éval | 1 250 $ | 600 $ | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-pro-dll-25k` | funded | aucun | 600 $ puis LucidScale 60 % | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 40 % (payout) | oui |
| `lucid-pro-dll-50k` | éval | 3 000 $ | 1 200 $ | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-pro-dll-50k` | funded | aucun | 1 200 $ puis LucidScale 60 % | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 40 % (payout) | oui |
| `lucid-pro-dll-100k` | éval | 6 000 $ | 1 800 $ | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-pro-dll-100k` | funded | aucun | 1 800 $ puis LucidScale 60 % | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 40 % (payout) | oui |
| `lucid-pro-dll-150k` | éval | 9 000 $ | 2 700 $ | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-pro-dll-150k` | funded | aucun | 2 700 $ puis LucidScale 60 % | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | 40 % (payout) | oui |
| `lucid-daily-eod-25k` | éval | 1 250 $ | aucun | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 50 % (objectif) | oui |
| `lucid-daily-eod-25k` | funded | aucun | aucun | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-daily-eod-50k` | éval | 3 000 $ | aucun | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 50 % (objectif) | oui |
| `lucid-daily-eod-50k` | funded | aucun | aucun | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-daily-eod-100k` | éval | 6 000 $ | aucun | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 50 % (objectif) | oui |
| `lucid-daily-eod-100k` | funded | aucun | aucun | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-daily-eod-150k` | éval | 9 000 $ | aucun | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | 50 % (objectif) | oui |
| `lucid-daily-eod-150k` | funded | aucun | aucun | 4 500 $ | trailing intraday | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-daily-intraday-25k` | éval | 1 250 $ | aucun | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | 50 % (objectif) | oui |
| `lucid-daily-intraday-25k` | funded | aucun | aucun | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-daily-intraday-50k` | éval | 3 000 $ | aucun | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | 50 % (objectif) | oui |
| `lucid-daily-intraday-50k` | funded | aucun | aucun | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-daily-intraday-100k` | éval | 6 000 $ | aucun | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | 50 % (objectif) | oui |
| `lucid-daily-intraday-100k` | funded | aucun | aucun | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-daily-intraday-150k` | éval | 9 000 $ | aucun | 4 500 $ | trailing intraday | 154 600 $ (150 100 $) | 50 % (objectif) | oui |
| `lucid-daily-intraday-150k` | funded | aucun | aucun | 4 500 $ | trailing intraday | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-daily-dll-eod-25k` | éval | 1 250 $ | 600 $ | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-eod-25k` | funded | aucun | 600 $ | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-daily-dll-eod-50k` | éval | 3 000 $ | 1 200 $ | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-eod-50k` | funded | aucun | 1 200 $ | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-daily-dll-eod-100k` | éval | 6 000 $ | 1 800 $ | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-eod-100k` | funded | aucun | 1 800 $ | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-daily-dll-eod-150k` | éval | 9 000 $ | 2 700 $ | 4 500 $ | trailing EOD | 154 600 $ (150 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-eod-150k` | funded | aucun | 2 700 $ | 4 500 $ | trailing intraday | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-daily-dll-intraday-25k` | éval | 1 250 $ | 600 $ | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-intraday-25k` | funded | aucun | 600 $ | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | aucune | oui |
| `lucid-daily-dll-intraday-50k` | éval | 3 000 $ | 1 200 $ | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-intraday-50k` | funded | aucun | 1 200 $ | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | aucune | oui |
| `lucid-daily-dll-intraday-100k` | éval | 6 000 $ | 1 800 $ | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-intraday-100k` | funded | aucun | 1 800 $ | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | aucune | oui |
| `lucid-daily-dll-intraday-150k` | éval | 9 000 $ | 2 700 $ | 4 500 $ | trailing intraday | 154 600 $ (150 100 $) | 50 % (objectif) | oui |
| `lucid-daily-dll-intraday-150k` | funded | aucun | 2 700 $ | 4 500 $ | trailing intraday | 154 600 $ (150 100 $) | aucune | oui |
| `lucid-direct-25k` | direct | aucun | aucun | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 20 % (payout) | oui |
| `lucid-direct-50k` | direct | aucun | 1 200 $ puis LucidScale 60 % | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 20 % (payout) | oui |
| `lucid-direct-100k` | direct | aucun | 2 100 $ puis LucidScale 60 % | 3 500 $ | trailing EOD | 103 600 $ (100 100 $) | 20 % (payout) | oui |
| `lucid-direct-150k` | direct | aucun | 3 000 $ puis LucidScale 60 % | 5 000 $ | trailing EOD | 155 100 $ (150 100 $) | 20 % (payout) | oui |
| `lucid-maxx-25k` | éval | 1 250 $ | aucun | 1 000 $ | trailing EOD | non documenté | 40 % (objectif) | oui |
| `lucid-maxx-50k` | éval | 3 000 $ | aucun | 2 000 $ | trailing EOD | non documenté | 40 % (objectif) | oui |
| `lucid-maxx-100k` | éval | 6 000 $ | aucun | 3 000 $ | trailing EOD | non documenté | 40 % (objectif) | oui |
| `lucid-maxx-150k` | éval | 9 000 $ | aucun | 4 500 $ | trailing EOD | non documenté | 40 % (objectif) | oui |

### Apex Trader Funding

| Plan | Phase | Objectif | DD journalier | DD max | Type DD | Figé à (seuil) | Consistency | À revoir |
|---|---|---|---|---|---|---|---|---|
| `apex-intraday-25k` | éval | 1 500 $ | aucun | 1 000 $ | trailing intraday | Tradovate : jamais ; Rithmic/WealthCharts : 27 500 $ (26 500 $) | aucune | non |
| `apex-intraday-25k` | funded | aucun | 500 $ (paliers jusqu'à 1 250 $) | 1 000 $ | trailing intraday | 26 100 $ (25 100 $) | 50 % (payout) | non |
| `apex-intraday-50k` | éval | 3 000 $ | aucun | 2 000 $ | trailing intraday | Tradovate : jamais ; Rithmic/WealthCharts : 55 000 $ (53 000 $) | aucune | non |
| `apex-intraday-50k` | funded | aucun | 1 000 $ (paliers jusqu'à 3 000 $) | 2 000 $ | trailing intraday | 52 100 $ (50 100 $) | 50 % (payout) | non |
| `apex-intraday-100k` | éval | 6 000 $ | aucun | 3 000 $ | trailing intraday | Tradovate : jamais ; Rithmic/WealthCharts : 109 000 $ (106 000 $) | aucune | non |
| `apex-intraday-100k` | funded | aucun | 1 750 $ (paliers jusqu'à 3 500 $) | 3 000 $ | trailing intraday | 103 100 $ (100 100 $) | 50 % (payout) | non |
| `apex-intraday-150k` | éval | 9 000 $ | aucun | 4 000 $ | trailing intraday | Tradovate : jamais ; Rithmic/WealthCharts : 163 000 $ (159 000 $) | aucune | non |
| `apex-intraday-150k` | funded | aucun | 2 500 $ (paliers jusqu'à 4 000 $) | 4 000 $ | trailing intraday | 154 100 $ (150 100 $) | 50 % (payout) | non |
| `apex-eod-25k` | éval | 1 500 $ | 500 $ | 1 000 $ | trailing EOD | Tradovate : jamais ; Rithmic/WealthCharts : 27 500 $ (26 500 $) | aucune | non |
| `apex-eod-25k` | funded | aucun | 500 $ (paliers jusqu'à 1 250 $) | 1 000 $ | trailing EOD | 26 100 $ (25 100 $) | 50 % (payout) | non |
| `apex-eod-50k` | éval | 3 000 $ | 1 000 $ | 2 000 $ | trailing EOD | Tradovate : jamais ; Rithmic/WealthCharts : 55 000 $ (53 000 $) | aucune | non |
| `apex-eod-50k` | funded | aucun | 1 000 $ (paliers jusqu'à 3 000 $) | 2 000 $ | trailing EOD | 52 100 $ (50 100 $) | 50 % (payout) | non |
| `apex-eod-100k` | éval | 6 000 $ | 1 500 $ | 3 000 $ | trailing EOD | Tradovate : jamais ; Rithmic/WealthCharts : 109 000 $ (106 000 $) | aucune | non |
| `apex-eod-100k` | funded | aucun | 1 750 $ (paliers jusqu'à 3 500 $) | 3 000 $ | trailing EOD | 103 100 $ (100 100 $) | 50 % (payout) | non |
| `apex-eod-150k` | éval | 9 000 $ | 2 000 $ | 4 000 $ | trailing EOD | Tradovate : jamais ; Rithmic/WealthCharts : 163 000 $ (159 000 $) | aucune | non |
| `apex-eod-150k` | funded | aucun | 2 500 $ (paliers jusqu'à 4 000 $) | 4 000 $ | trailing EOD | 154 100 $ (150 100 $) | 50 % (payout) | non |

## Plans à revoir (`needs_review`)

### Lucid : trois questions transverses (concernent les 40 plans)

> **Résolu le 2026-10-04** par le support Lucid (Harsh [LUCD], Discord) : MLL EOD contrôlé en temps réel, P&L latent compris (la position est liquidée et le compte échoue) ; DLL mesurée de la même façon, soft breach jusqu'au jour suivant ; reset de la DLL en fin de journée à **17:30** heure de New York (et non 18:00). 36 plans sortis de `needs_review`, voir « Réponses des supports ».

1. **Le MLL EOD est-il contrôlé en temps réel sur l'equity ?** Lucid décrit le calcul du seuil (plus haut solde de clôture) et précise, pour LucidDaily, que le P&L latent n'entre pas dans le calcul EOD. Il ne dit nulle part si une perte latente qui fait passer l'equity sous le MLL en séance liquide le compte. Apex, lui, le dit explicitement. C'est la question la plus critique pour l'alerte de liquidation. Dans le catalogue : `enforced_on: null` pour tous les drawdowns EOD Lucid. Concerne Flex, Pro, Direct, Maxx et les évaluations LucidDaily EOD. Les drawdowns intraday LucidDaily sont documentés (P&L latent inclus).
2. **Base de la DLL** (réalisé seul ou réalisé + latent) : non documentée. `basis: null` sur toutes les DLL Lucid. Impact limité : la DLL Lucid est un soft breach (pause jusqu'à la session suivante, le compte reste actif).
3. **Heure de reset de la DLL** : Lucid dit « jusqu'à la prochaine session ». `resets_at` est fixé à 18:00 America/New_York, déduit de l'article Allowed Trading Times (reprise à 18:00). C'est une déduction, pas une phrase explicite.

En attendant, le calcul MTC doit traiter un `enforced_on: null` comme `equity_realtime`, le cas le plus prudent, et l'afficher comme une estimation.

### Lucid : raisons propres à certains plans

| Plans | Raison |
|---|---|
| `lucid-flex-dll-*` (4) | DLL funded relevée sur le sélecteur du site (« DLL (Below Initial Trail) », mêmes montants qu'en évaluation) ; le help center ne la chiffre pas et ne dit pas ce qu'elle devient au-dessus de l'Initial Trail Balance. |
| `lucid-pro-*` (8) | `payout.min_days = 3` vient du site (« Days to Payout 3 ») ; l'article LucidPro Payouts n'a pas de minimum de jours. |
| `lucid-pro-dll-25k` | Contradiction de sources sur la DLL 25K, voir plus bas. |
| `lucid-daily-*` (16) | Heure de clôture obligatoire et positions overnight non documentées : l'article Allowed Trading Times ne cite que Pro, Flex et Direct. `must_close_by: null`, `overnight_allowed: null`. |
| `lucid-direct-*` (4) | `payout.min_days = 5` vient du site (« Min Day to Payout 5 ») mais n'apparaît pas dans l'article LucidDirect Payout Objectives. |
| `lucid-maxx-*` (4) | Programme sur invitation. Taille max, seuil de blocage du trailing et horaires non publiés pour l'évaluation Maxx. Le type « EOD » vient de l'article Overview (niveau programme), pas des règles d'évaluation. |

### Apex

Aucun plan en `needs_review`. Deux déductions à connaître :

- **Blocage du trailing en évaluation Rithmic / WealthCharts** : la règle générale dit que le seuil se fige quand il atteint le solde objectif. L'exemple chiffré ne couvre que le 50K (seuil 53 000, atteint à 55 000). Pour les autres tailles, `locks_at` = solde objectif + drawdown est la conséquence directe de cette règle. Une FAQ écrit « Profit Target Balance + $2,000 » : vrai pour le 50K seulement (drawdown de 2 000). Sans effet sur Tradovate, où le trailing d'évaluation ne se fige jamais.
- **Consistency PA** : le plus gros jour doit être **strictement** inférieur à 50 % du profit (« 50 % or more » bloque).

## Contradictions entre sources

| Sujet | Source A | Source B | Retenu |
|---|---|---|---|
| DLL LucidPro 25K, évaluation, option DLL ON | Sélecteur lucidtrading.com : 600 $ | Article LucidPro Evaluation Account (2026-08-26) : « None » | 600 $ : la page produit est propre à la variante DLL ON, l'article ne distingue pas les variantes. `needs_review`. |
| DLL LucidPro 25K, funded | Article LucidPro Funded Account (2026-08-26) : DLL fixe 600 $ (optionnelle) | Article LucidPro Daily Loss Limit (2026-07-26) : « None » | 600 $ : article le plus récent, cohérent avec le site. `needs_review`. |
| Palier 4 du PA Apex 50K | Scaling Levels Explained : « 5 999 $ et plus » | Daily Loss Limit Explained : « 6 000 $ et plus » | 6 000 $ (le palier 3 s'arrête à 5 999 $). Écart d'un dollar, sans effet pratique. |
| Minimum de jours avant payout LucidDirect | Site : « Min Day to Payout 5 » | Help center : aucune mention | 5, `needs_review`. |
| Minimum de jours avant payout LucidPro | Site : « Days to Payout 3 » (fiche Funded Rules) | Article LucidPro Payouts : aucune mention | 3, `needs_review`. |
| DLL funded LucidFlex (option DLL ON) | Site : « DLL (Below Initial Trail) » 600 / 1 200 / 1 800 / 2 700 $ | Help center : DLL funded « Optional », non chiffrée | Montants du site, `needs_review` (comportement au-dessus du trail non documenté). |
| Scaling du PA Apex Legacy | Carte de vente legacy-products : « Scaling: None » | Article Legacy PA Trading Rules (2026-07-31) : moitié des contrats jusqu'au safety net | Règle du help center : la carte décrit l'évaluation, le scaling ne vaut qu'en PA (support, 2026-10-05). Moitié arrondie à l'inférieur. |
| Prix Apex « No Activation Fee » | 25K intraday affiché 690 $, plus cher que le 50K (490 $) | | Relevé tel quel dans `price.notes`. Probable anomalie d'affichage du prix barré. |

## Règles qui n'entrent pas proprement dans le schéma

| Règle | Où elle est | Proposition |
|---|---|---|
| **DLL qui dépasse le drawdown max** (Apex PA : 25K palier 3 = 1 250 $ pour un drawdown de 1 000 $, 50K palier 4 = 3 000 $ pour 2 000 $, 100K palier 5 = 3 500 $ pour 3 000 $) | `daily_loss_limit.tiers` | Le contrôle « DLL <= drawdown » ne porte que sur le montant de base. Côté calcul, la limite effective du jour est `min(DLL du palier, distance au seuil de drawdown)`. |
| **LucidScale DLL** : au-delà de l'Initial Trail Balance, DLL = 60 % du plus haut profit EOD, sans plafond tabulé | `daily_loss_limit.scaling_rule` (texte) | Au prompt du seed, ajouter un champ structuré (`{ "kind": "pct_of_peak_eod_profit", "pct": 0.6, "after_balance": 52100 }`) pour pouvoir le calculer. |
| **Blocage du trailing selon la plateforme** (évaluations Apex) | `max_drawdown.platform_overrides` | Le calcul doit lire la plateforme du compte (Tradovate pour MTC aujourd'hui). |
| **Flex : MLL figé dès la 1re demande de payout**, même sous l'Initial Trail Balance | `basis_notes` (funded Flex) | Événement « payout demandé » à suivre côté MTC ; champ dédié possible (`locks_on_first_payout: true`). |
| **Profit journalier maximum LucidDaily** (6 000 à 12 000 $ selon taille) : l'atteindre fait passer le compte en live | `payout.notes` | Champ `max_daily_profit` si on veut l'afficher comme objectif. |
| **Inactivité** (Apex PA : 2 jours à 50 $ net par période glissante de 30 jours) | `payout.notes` | Champ `inactivity` si on veut alerter avant la fermeture. |
| **Règle news LucidDaily** : être flat de 1 min avant à 1 min après une news USD à fort impact, sinon hard breach | `time_rules.notes`, `news_trading_allowed: false` | Brancher sur le calendrier éco MTC (`eco-event-key.ts`) pour une alerte. |
| **Taille max en contrats** : Lucid et Apex comptent 10 micros pour 1 mini, toutes positions confondues | `max_contracts.minis` / `micros` | Le calcul doit additionner l'exposition en « équivalent mini », pas comparer minis et micros séparément. |
| **Pas de prix fiable pour Lucid Flex, Pro et Daily** : le site renvoie au checkout et des promotions temporaires sont en cours | `price.amount: null` | Hors périmètre sécurité. À relever au checkout si on affiche les prix. |

## Re-vérification (2026-10-02, soir)

Relecture complète, source par source, après un doute sur LucidFlex 50K.

**Méthode**
- Lucid : les 33 pages du help center citées dans `source_urls`, plus la configuration du sélecteur de plans de lucidtrading.com (`window.LucidPricingConfig`, faces évaluation et « Funded Rules » de chaque programme et taille). Comparaison automatique du sélecteur aux 40 plans : 0 écart après corrections.
- Apex : les 19 pages du help center citées dans `source_urls` et la page d'accueil. Aucun écart sur les règles des 8 plans.

**LucidFlex 50K (sans DLL)** : conforme sur tous les points (objectif 3 000, MLL 2 000 EOD figé à 50 100 au-delà de 52 100, consistency 50 % en évaluation, 4 minis / 40 micros, scaling funded 2 / 3 / 4 minis, payout 5 jours à 150 $, 90 %, 500 à 2 000 $, 5 payouts, clôture 16:45 ET).

**Corrigé**
1. `lucid-flex-dll-*` : DLL funded renseignée (600 / 1 200 / 1 800 / 2 700 $), elle était à `null`.
2. `lucid-pro-*` : `payout.min_days = 3` ajouté (sélecteur du site), il manquait.
3. `lucid-daily-*` : la note des horaires affirmait une clôture automatique à 16:45 ET et `overnight_allowed: false`, alors qu'aucune source ne couvre LucidDaily. Remplacé par « non documenté » (`overnight_allowed: null`).

**Ajouté** : les 6 plans **Apex Legacy Full**, voir la section suivante.

## Apex Legacy (ajouté le 2026-10-02, soir)

Gamme d'avant le 2026-03-01, revenue en vente en promotion limitée (`apextraderfunding.com/legacy-products`) : 25K, 50K, 100K, 150K, 250K, 300K « Full », sur Tradovate, WealthCharts et Rithmic, mêmes règles et prix sur les trois. Ids `apex-legacy-<taille>k`, programme « Legacy Full ».

Sources : page de vente Legacy et la section Legacy du help center (liste complète via `help-center-sitemap.xml`, articles mis à jour entre le 2026-04-15 et le 2026-09-16).

| Taille | Contrats | Objectif | Trailing | Prix / mois | Frais PA | Plafond payouts 1 à 5 |
|---|---|---|---|---|---|---|
| 25K | 4 (40 micros) | 1 500 | 1 500 | 177 | 89 | 1 500 |
| 50K | 10 (100) | 3 000 | 2 500 | 197 | 99 | 2 000 |
| 100K | 14 (140) | 6 000 | 3 000 | 397 | 129 | 2 500 |
| 150K | 17 (170) | 9 000 | 5 000 | 597 | 169 | 2 750 |
| 250K | 27 (270) | 15 000 | 6 500 | 697 | 179 | 3 000 |
| 300K | 35 (350) | 20 000 | 7 500 | 797 | 199 | 3 500 |

- **Évaluation** : trailing intraday (plus haut solde latent inclus), pas de DLL, 7 jours de trading minimum (sauf promotion « 1-day pass »), pas de limite de durée (abonnement mensuel). Blocage du trailing : Rithmic au solde objectif, Tradovate jamais, WealthCharts non documenté.
- **PA** : trailing intraday figé à capital + 100 $ au safety net (capital + drawdown + 100 $), pas de DLL, consistency 30 % jusqu'au 6e payout, contract scaling (moitié des contrats jusqu'au safety net). Payout : 8 jours de trading dont 5 à 50 $ ou plus, 500 $ minimum, plafond sur les 5 premiers puis sans plafond (`max_amount_schedule` se termine par `null`, ajout au schéma), 100 % sur les 25 000 premiers $ par compte puis 90 % (`split_pct = 1`, nuance dans `notes`), safety net pour les 3 premiers payouts seulement.
- **Hors schéma** (dans `notes`) : règle MAE 30 % (perte latente ouverte), ratio risque/rendement 5:1, une seule direction, pas de hedging, inactivité.

**Pourquoi `needs_review`**
- Contradiction : la carte de vente affiche « Scaling: None », l'article Legacy PA Trading Rules (2026-07-31) impose la moitié des contrats jusqu'au safety net. Retenu : la règle du help center, la plus restrictive. Levée le 2026-10-05 : le scaling ne s'applique qu'au PA, la carte décrit l'évaluation ; la moitié est arrondie à l'inférieur (17 → 8).
- Moitié de 17, 27 et 35 contrats (150K, 250K, 300K) : arrondi non documenté, paliers laissés vides.
- Trailing d'évaluation sur WealthCharts non documenté.
- Inactivité : la politique Legacy (1 jour à 150 $ par 30 jours) renvoie, pour les produits promotionnels vendus après le 2026-03-01, à la nouvelle politique (2 jours à 50 $).

## Quatre firms ajoutées (relevé du 2026-10-03)

Sources : sites et help centers officiels uniquement, lus dans un navigateur (sélecteurs de prix compris). Chaque plan liste ses pages dans `source_urls`. Les comptes Live (appel de l'équipe risque) ne sont pas modélisés.

### Ajouts au format (`schema.json`, tous optionnels)

| Champ | Pourquoi |
|---|---|
| `phase.starting_balance` | Comptes funded qui démarrent à 0 $ (Topstep XFA, MyFundedFutures Rapid / Rapid EOD / Builder). Les seuils (`locks_at`, `locked_floor`, `safety_net_balance`) sont exprimés dans ce référentiel. |
| `configuration.payout_path` | Parcours de payout choisi qui change les règles funded : Topstep XFA Standard / Consistency, Tradeify Select Flex / Daily. |
| `configuration.addon` | Option payante qui change une règle : Tradeify « consistency 50 % », MyFundedFutures Builder « drawdown 1 500 $ ». |
| `consistency.max_single_day_pct_schedule` | Seuil par numéro de payout (Tradeify Lightning 20 / 25 / 30 %). |
| `payout.split_by_profit` | Partage selon le profit présent sur le compte (TradeDay Quick Pay : 50 % sous 4 000 $, 80 % au-delà). |

### Plans

| Firm | Plans | Tailles | `needs_review` |
|---|---|---|---|
| Topstep | Trading Combine × (DLL oui / non) × (payout Standard / Consistency) | 50K, 100K, 150K | 0 / 12 |
| Tradeify | Growth, Lightning Funded, Select × (Flex / Daily) × (consistency 40 % / 50 %) | 25K à 150K | 9 / 24 |
| MyFundedFutures | Rapid, Rapid EOD (25K, 50K), Pro (50K à 150K), Builder (+ option drawdown 1 500 $ en 50K) | 25K à 150K | 9 / 14 |
| TradeDay | Quick Pay intraday, Quick Pay EOD, Fast Pass EOD | 25K à 150K | 3 / 12 |

Exclus volontairement : Tradeify Select 300K et « Level Up » (éditions limitées, deux versions du 300K) ; MyFundedFutures Flex (rangé dans « Legacy Plans », absent du sélecteur) ; comptes Live de toutes les firms.

### Écarts avec les chiffres fournis dans le prompt du 2026-10-03

| Point du prompt | Source officielle | Retenu |
|---|---|---|
| Tradeify Growth : drawdown 1 100 / 2 000 / 3 500 / 4 900 $ | Article Growth Evaluation : 1 000 / 2 000 / 3 500 / 5 000 $ (cohérent avec le tableau de lock 26 100 / 52 100 / 103 600 / 155 100 $) | Source officielle |
| Tradeify Lightning : 25K introuvable, 150K 5 900 $ | Article Lightning : 25K à 1 000 $, 150K à 5 250 $ ; le tableau de lock de l'article drawdown implique 6 000 $ pour le 150K | 25K ajouté ; 150K à 5 250 $. Levée le 2026-10-05 : les 6 000 $ ne valent que pour les 150K d'avant le nouveau dashboard |
| Tradeify Select : drawdown non chiffré | Article Select : 1 000 / 2 000 / 3 000 / 4 500 $ en évaluation ; Daily funded 1 000 / 2 000 / 2 500 / 3 500 $ | Source officielle |
| MyFundedFutures Rapid EOD : lock à 0 $ | Le plancher à 0 $ concerne le compte **Live** ; le funded sim démarre à 0 $ et se verrouille à **100 $** | Source officielle |
| MyFundedFutures Builder : 1 500 $ avec option sur le 25K | L'option drawdown 1 500 $ porte sur le **50K** | Source officielle |
| MyFundedFutures Flex | Plan « Legacy », plus dans le sélecteur | Exclu |
| TradeDay : seul le 100K chiffré | Le sélecteur de prix chiffre les 4 tailles (drawdown 1 000 / 2 000 / 3 000 / 4 500 $) | 4 tailles |
| TradeDay : lock à 100 000 $ exactement (100K) | Confirmé (seuil figé au solde de départ) | Conforme |
| Topstep : MLL, DLL, XFA | Conformes ; la DLL est une **option** choisie à l'achat, l'XFA a deux parcours de payout | Variantes en plans distincts |

### Contradictions à l'intérieur des sources

| Sujet | Source A | Source B | Retenu |
|---|---|---|---|
| Tradeify Lightning 150K, drawdown | Article Lightning : 5 250 $ | Tableau de lock (Trailing Max Drawdowns) : déclenchement 156 100 $ (= 6 000 $) | 5 250 $, `locks_at` à null, `needs_review` |
| Tradeify Select 25K, taille max en évaluation | Article Select Evaluation : 1 mini / 10 micros | Article des payouts Select : 2 / 20 en évaluation | 1 / 10, `needs_review` |
| MyFundedFutures Rapid, verrouillage du funded | Help center et page : le seuil se fige quand il atteint 100 $ (profit = drawdown + 100 $) | FAQ de la page Rapid : « après le premier payout » | Help center, `needs_review` |
| MyFundedFutures Builder, tailles | En-tête de page : « $25K & $50K » | Tableau des règles et sélecteur : 25K à 150K | 4 tailles, `needs_review` |
| MyFundedFutures Pro, taille | Sous-titre : « $90K–$150K » | Page Pro et sélecteur : 50K, 100K, 150K | 50K à 150K |
| MyFundedFutures Rapid EOD, news funded | Article Rapid EOD : Tier 1 interdit | Politique news : seuls Rapid et Pro funded sont listés | Interdit (le plus prudent) |

### Valeurs non publiées (`null`)

- Tradeify : taille max du funded Growth ; base des DLL (réalisé ou latent).
- ~~Topstep : base de la DLL (« Net P&L », latent non précisé).~~ Réglé le 2026-10-05 : réalisé + latent, contrôlée en temps réel.
- MyFundedFutures Builder : heure de reprise et base de la DLL ; prix de l'option drawdown 1 500 $.
- TradeDay Fast Pass funded : taille maximale (scaling « +1 contrat par 2 000 $ », maximum publié seulement pour le 25K).


## Dix firms ajoutées (relevé des 2026-10-03 et 2026-10-04)

Objectif : couvrir les firms futures que TradesViz ou Edgely proposent et que nous n'avions pas (issue #354). Sources : sites et help centers officiels uniquement ; où les lire est décrit dans le README (« Re-vérifier une firm »).

| Firm | Fichier | Plans | `needs_review` | Programmes |
|---|---|---|---|---|
| Take Profit Trader | `takeprofittrader.json` | 5 | 0 | Test (+ PRO) |
| Phidias Propfirm | `phidias.json` | 10 | 10 | Express to Live, Fundamental, Premium |
| Earn2Trade | `earn2trade.json` | 7 | 7 | Trader Career Path, Gauntlet Mini |
| Top One Futures | `toponefutures.json` | 27 | 12 | Elite, Elite Daily, Elite Access, Elite Access Intraday, Instant Sim Funded 2.0, Ignite, X-Ultra |
| BluSky Trading | `blusky.json` | 15 | 15 | Launch, Propel, Orbit, Instant Sim Funded, Direct to Funded |
| Funded Futures Family | `fundedfuturesfamily.json` | 21 | 21 | Prime, Premier+ (EOD / intraday), Velocity, Straight to Funded, Accelerate S2F |
| OneUp Trader | `oneuptrader.json` | 10 | 10 | Evaluation, Pro Evaluation |
| UProfit | `uprofit.json` | 6 | 0 | Day Soft, Day Flex |
| Bulenox | `bulenox.json` | 24 | 8 | Qualification + Master, Fast Track, Momentum (Option 1 trailing / Option 2 EOD) |
| Elite Trader Funding | `elitetraderfunding.json` | 14 | 14 | 1 Step, End of Day, Diamond Hands, Static, Fast Track, Direct to Funded |

### Pourquoi `needs_review`

- **Contrôle en séance non documenté** (`enforced_on: null`) : Phidias (tous), Top One Instant / Ignite / X-Ultra, BluSky Sim Funded et Orbit funded, Funded Futures Family (Prime, Premier+ EOD, S2F). Le calcul MTC compare l'equity, cas prudent.
- **Prix non publiés hors navigateur** (`price.amount: null`) : BluSky (abonnements), Funded Futures Family (sauf Velocity 25K, « à partir de 16 $ »), Top One Elite et X-Ultra, Elite Trader Funding (toutes les évaluations, tarif calculé dans l'app).
- **Drawdown funded non chiffré séparément** : Elite Trader Funding (repris de l'évaluation), Bulenox Momentum Master, OneUp Trader.
- **Règles hors schéma** :
  - OneUp Trader : consistency « les 3 autres meilleurs jours font au moins 80 % du meilleur jour », non exprimable en pourcentage maximal ; grille de scaling funded publiée en image.
  - Earn2Trade : paliers de la Progression Ladder publiés en image ; phase funded modélisée en LiveSim (EOD), le Live passe en trailing intraday.
  - BluSky : la Buffer Zone (entre l'évaluation et le Sim Funded) n'est pas une phase du schéma ; elle est décrite dans `notes`. Le Sim Funded démarre au profit construit en Buffer Zone (`starting_balance`), avec un solde minimum de 100 $.
  - ~~Phidias : heure de clôture publiée en UTC fixe (21:59) dans un article, à 22:00 UTC+2 dans un autre.~~ Réglé le 2026-10-06 : 22:59 heure de Paris toute l'année.

### Écarts et choix

| Sujet | Source A | Source B | Retenu |
|---|---|---|---|
| Phidias, frais d'activation | Site FR : 80 / 139 / 139 / 159 € | Article 17 et site EN : 83 / 149 / 149 / 169 $ | Dollars (devise du compte) |
| Phidias E2L, jours minimum | Comparatif du site : 1 | Fiche taille : 0, article E2L : « aucun » | Aucun |
| Phidias, plancher CASH 150K | Article EOD : 50K et 100K seulement | Article retraits : 150 100 $ | 150 100 $ |
| Top One Elite Daily, DLL 150K | Fiche V2 : 1 850 $ | Tableau général des DLL : « n/a » | 1 850 $, `needs_review` |
| Top One Elite Daily, reset évaluation | Article : 93 / 115 / 214 / 297 $ | Page d'accueil : 75 / 93 $ (25K / 50K) | Les deux en notes |
| Top One Instant, DLL | Fiche Instant : « account breach » | Article général : soft breach sauf X-Ultra | Échec (prudent) |
| Top One Ignite, clôture | Fiche Ignite : 16:00 ET | Règle générale : 16:10 ET | 16:00 |
| FFF S2F 25K, contrats | Fiche : 1 mini | Grille de scaling : jusqu'à 3 | 3 minis (le support renvoie à la grille, 2026-10-04) |

### Non modélisés

- Take Profit Trader PRO+ (live sur invitation), Phidias 10K Drawdown Challenge (compétition), Earn2Trade comptes Live du growth plan, Top One S2F Sim Pro (absent des pages actuelles), BluSky Stocks, FFF Prestige (sur invitation, bascule directement en live) et Base 2K (drawdown égal à la taille du compte, chiffres ambigus), UProfit Day / One (gammes historiques), Elite Trader Funding LIVE ELITE.

### Réponses des supports

| Date | Firm | Réponse | Effet |
|---|---|---|---|
| 2026-10-04 | Funded Futures Family | S2F : la grille de scaling fait foi. Prix visibles seulement au paiement (dashboard). Base 2K retiré de la vente (départ 2 000 $, perte max 2 000 $). Drawdown EOD : seul le calcul du seuil est redécrit ; contrôle en séance, blocage en évaluation Prime et contrats « Standard / Max » non répondus (relance envoyée). | S2F 25K à 3 minis ; notes de prix ; `needs_review` maintenu |
| 2026-10-04 | Lucid (Harsh [LUCD], Discord) | MLL EOD contrôlé en temps réel, latent compris. DLL : latent compris, soft breach, reset à 17:30 ET. DLL Flex funded toujours active au-dessus de l'Initial Trail Balance. DLL Pro 25K = 600 $ (option DLL). 3 jours minimum par cycle en Pro (consistency 40 %), 5 en Direct (20 %). LucidDaily : overnight interdit. Clôture à 16:45 ET sur tous les comptes, LucidDaily et LucidMaxx compris. LucidMaxx : renvoi à l'article Overview (taille et blocage non publiés). | 36 plans sortis de `needs_review` (Flex, Pro, Direct, Daily). Restent : LucidMaxx (4) |
| 2026-10-04 | Top One Futures (e-mail, style de réponse générée) | Instant 2.0 : DLL en soft breach (seul X-Ultra en hard). Instant, Ignite, X-Ultra : seuil relevé en fin de journée mais dépassement vérifié en continu, latent compris. Ignite : clôture 16:10 ET retenue. Reset Elite Daily : 93 / 115 / 214 / 297 $. X-Ultra 50K : 258 $. Elite Daily 150K : « pas de DLL en évaluation », contredit l'article DLL Evaluation Phase V2 (1 850 $). Prix Elite non répondu (réponse sur Elite Access). | 11 plans sortis de `needs_review` (Instant, Ignite, X-Ultra) ; Elite Daily 150K maintenu |
| 2026-10-04 | Funded Futures Family (Kenny, relance) | Drawdown EOD : échec immédiat si les pertes ouvertes font passer l'equity sous le seuil en séance. Évaluation Prime : le drawdown se bloque aussi après l'Initial Trail Balance. Standard / Max : deux variantes choisies à l'achat. Velocity et Accelerate : le trailing intraday ne se bloque jamais. | Contrôle en temps réel sur les plans EOD ; blocage en évaluation Prime ; Prime scindé en Standard (ids inchangés) et Max (`fundedfuturesfamily-prime-max-*`, `configuration.addon = "max"`) ; les 25 plans FFF sortent de `needs_review` |
| 2026-10-04 | TradeDay (Ajaybee, e-mail) | Fast Pass : le funded garde le même maximum de contrats que l'évaluation (2/20, 5/50, 10/50, 15/50). Prix cités : 130 / 180 / 320 / 480 $. | 3 plans Fast Pass sortent de `needs_review` ; écart de prix noté (promotion probable) |
| 2026-10-04 | UProfit (Gonzalo, e-mail) | News autorisées (déconseillées). Base de la DLL Soft non répondue (renvoi à l'article des paramètres). | `news_trading_allowed: true` sur les 6 plans |
| 2026-10-04 | Tradeify (e-mail automatique) | L'adresse hey@ ne traite pas le support : passer par le chat du centre d'aide. | Aucun ; questions à reposer par chat |
| 2026-10-04 | UProfit (Paula, e-mail, relance) | DLL Day Soft : pertes latentes des positions ouvertes et commissions comprises ; atteinte même sans clôturer la position. | `basis: equity` sur les 6 DLL Day Soft |
| 2026-10-05 | BluSky (BluGuy, e-mail) | Reprend le help center : solde minimum Sim Funded 100 $ ; contrats Orbit confirmés, Launch / Propel seulement sous les anciens noms de plans ; Buffer Zone : seuils de blocage non publiés ; DLL Instant 1 000 $ et Direct to Funded 2 000 $ = pause jusqu'au lendemain (« as long as Max drawdown level also is hit », sans doute « n'est pas touché ») ; prix : renouvellement au prix d'achat, montants non donnés. | DLL Instant et Direct to Funded en `trading_paused_for_day` ; `needs_review` maintenu (contrôle en séance, prix) |
| 2026-10-05 | Top One Futures (relance) | Elite Daily : a bien une DLL (contradiction du 150K levée, 1 850 $ en évaluation conservé). Elite classique : n'est plus vendu. X-Ultra : renvoi à la page Launchpad (100K 378 $, 150K 518 $, paiement unique). | Elite Daily 150K sort de `needs_review` ; 4 plans `toponefutures-elite-*` retirés du catalogue (passés `active = false` par la synchro) ; prix X-Ultra complétés |
| 2026-10-05 | Lucid (AsadTheLion [LUCD], Discord) | Renvoi à l'article « New LucidMaxx Program » : nouveau parcours évaluation → Pre-Live → Live (Pre-Live : objectif et drawdown EOD égaux au drawdown de l'évaluation, sans consistency, Live Scaling Plan ; Live : MLL statique 100 $, 90/10, payouts quotidiens sans plafond). Taille max et blocage du trailing toujours pas publiés. | Notes des 4 plans `lucid-maxx-*` mises à jour, source ajoutée ; `needs_review` maintenu |
| 2026-10-05 | Tradeify (articles du centre d'aide, transmis par le support) | Lightning Funded : drawdown 150K de 5 250 $ pour les comptes actuels, 6 000 $ et DLL 3 750 $ seulement pour les 150K achetés avant le nouveau dashboard. Paramètres, objectifs, plafonds de payout et consistency 20 / 25 / 30 % conformes au catalogue. Consistency : Growth funded 35 %, Select 40 % en évaluation seulement ; toutes les métriques du dashboard en temps réel sauf le Trailing Max Drawdown (fin de journée). | `tradeify-lightning-150k` sort de `needs_review` (blocage à 155 350 $). Restent : taille max de l'évaluation Select 25K, taille max du Growth funded, base de la DLL |
| 2026-10-05 | Lucid (AsadTheLion [LUCD], Discord, relance) | LucidMaxx évaluation : même taille maximale que les évaluations standard ; drawdown figé à départ + 100 $, comme les évaluations standard. | Les 4 plans `lucid-maxx-*` sortent de `needs_review` (2 / 4 / 6 / 10 minis, blocage à départ + drawdown + 100 $). Lucid : 40 plans sur 40 complets |
| 2026-10-05 | Tradeify (assistant du support, Discord) | Select 25K : 1 mini / 10 micros en évaluation ; en funded (Flex ou Daily), départ à 1 mini puis jusqu'à 2 minis / 20 micros par scaling : les deux articles ne se contredisent pas. Taille max du Growth funded et base de la DLL : non documentées, renvoi à un agent humain. | Les 4 plans Select 25K sortent de `needs_review` (modélisation déjà conforme). Restent : Growth (taille max funded), base de la DLL |
| 2026-10-05 | Tradeify (Luisa, chat du dashboard) | Growth Sim Funded : 1 / 4 / 8 / 12 minis (10 micros = 1 mini) sur la position totale, sans scaling, dès le premier trade. DLL : réalisé + latent, contrôlée en temps réel sur la valeur de liquidation nette, remise à zéro à chaque session. | Taille max des 4 Growth funded renseignée, `basis: equity` sur les 19 DLL Tradeify. Tradeify : 24 plans sur 24 complets |
| 2026-10-05 | Topstep (e-mail) | DLL calculée sur le Net P&L réalisé + latent, contrôlée en temps réel : atteinte même brièvement par une position ouverte = verrouillage immédiat. | `basis: equity` sur les 12 DLL (6 plans à option DLL, évaluation et XFA) |
| 2026-10-05 | Apex (Julian, ticket #1794125) | Legacy : le scaling ne s'applique qu'au PA (« Scaling: None » de la carte = évaluation) ; moitié arrondie à l'inférieur (150K, 17 contrats → 8). Seuil intraday figé au solde objectif, exemple donné sur une évaluation Intraday 50K Rithmic / WealthCharts actuelle (53 000 $ quand le pic atteint 55 000 $, conforme au catalogue). PA Legacy achetés après le 2026-03-01 : nouvelle politique d'inactivité (2 jours à 50 $). | Paliers de scaling renseignés sur les 6 PA Legacy ; contradiction levée ; inactivité confirmée. `needs_review` maintenu : blocage du trailing d'évaluation Legacy sur WealthCharts toujours pas chiffré pour le Legacy |
| 2026-10-06 | BluSky (BluGuy, e-mail, relance) | Reprend les articles publiés : Buffer Zone en trailing EOD sur Launch et Propel, statique sur Launch 200K ; Direct to Funded : compte de 3 500 $ en achat unique, drawdown statique 2 500 $ (clôture sous 1 000 $), DLL 2 000 $, consistency 21 %. Contrôle en séance du Sim Funded, blocage du trailing en Buffer Zone et prix du Direct to Funded : non répondus. | Conforme au catalogue, aucun changement ; `needs_review` maintenu |
| 2026-10-06 | OneUp Trader (Javier, e-mail) | Trailing calculé en temps réel, monte avec le solde pendant un trade (gains latents compris), se fige au solde de départ ; idem évaluation et funded. Évaluation : un micro compte comme un contrat (50K : 6 au maximum). Funded : 10 micros pour 1 contrat sur demande au partenaire, dans le palier de scaling. Express : mêmes règles que Regular / Pro, 3 jours minimum (prix non publié). | Drawdown en `trails_on: equity` / `equity_realtime`, micros = minis (évaluation et paliers funded, 10:1 sur demande en note). Les 10 plans sortent de `needs_review` ; Express non couvert |
| 2026-10-06 | MyFundedFutures (Ellis, e-mail) | Rapid funded : le Max Loss intraday se verrouille quand le plancher atteint 100 $, purement lié au solde, pas au premier payout. Builder : DLL soft (25K 600 $, 50K 1 000 $, 100K 1 750 $, 150K 2 500 $), pause jusqu'à la séance suivante, compte non en échec. Builder 100K et 150K vendus (6 et 9 minis, buffer 3 100 / 4 600 $, payout minimum 1 000 / 1 500 $, plafond 3 000 / 4 500 $ par cycle), consistency 50 %, 2 jours qualifiants, 5 payouts sim, 80/20 ; un Sim Funded 100K ou 150K ramène le total autorisé à 3. | Contradiction Rapid levée ; plafond du Builder 150K corrigé (3 500 → 4 500 $). Les 9 plans sortent de `needs_review` ; base de la DLL Builder toujours non précisée |
| 2026-10-06 | Phidias (ticket) | Liquidation : seuil comparé à l'equity en temps réel, pertes latentes comprises (une position ouverte sous le seuil est liquidée sans attendre sa clôture) ; le niveau du seuil n'est recalculé qu'en fin de journée sur les profits réalisés. Horaires : heure de Paris, fin de séance à 22:59 (20:59 UTC en été, 21:59 UTC en hiver). | `enforced_on: equity_realtime` sur les 10 plans, `must_close_by: 22:59 Europe/Paris` (E2L et Fundamental). Phidias : 10 plans sur 10 complets |
| 2026-10-06 | BluSky (Mike, chat du site) | Sim Funded (Launch / Propel / Orbit) : une perte latente qui passe sous le drawdown en séance fait échouer immédiatement. Buffer Zone : le trailing EOD se fige au solde de départ (graphique : 50 000 $, 2 500 $ de drawdown, seuil figé à 50 000 $). Direct to Funded : 749 $. | `enforced_on: equity_realtime` sur les 13 Sim Funded, blocage de la Buffer Zone en note, prix du Direct to Funded renseigné. 14 plans sortent de `needs_review` ; reste `blusky-direct-3500` (contrôle en séance non confirmé pour ce compte) |
| 2026-10-06 | BluSky (Neil, chat du site) | Direct to Funded : la DLL ne doit être dépassée à aucun moment ; solde minimum statique de 1 000 $, passer en dessous même avec une position ouverte fait échouer le compte. | `blusky-direct-3500` : `enforced_on: equity_realtime`, DLL `basis: equity`, sort de `needs_review`. BluSky : 15 plans sur 15 complets |

## Passage navigateur du 2026-10-05

Relecture dans Chrome des pages que les requêtes directes ne voyaient pas (sélecteurs de prix en JavaScript, grilles publiées en image, centres d'aide rendus côté client). Aucune question envoyée aux firms.

| Firm | Trouvé | Effet |
|---|---|---|
| Elite Trader Funding | Prix de tous les plans dans le sélecteur de `/evaluations`. 1-Step vendu en 50K / 100K / **150K** (sélecteur et article « How the 1-Step Plan Works ») ; le 250K ne figure plus que sur la page programme `/1-step-evaluation`. Plafonds de reward par cycle et par taille publiés dans les articles de chaque plan (1-Step : minimum 250 $). Static : seuil touché « at any time » = échec, en évaluation comme en Elite ; seuil appliqué par l'auto-liquidation du broker sur le solde en temps réel (article « Tracking Real-Time Drawdown »). Fast Track : paiement unique, 10 jours calendaires, 3 cycles de reward. Elite : drawdown identique à l'évaluation puis figé à départ + 100 $ au safety net (réalisé), confirmé pour chaque plan. | 14 plans sortent de `needs_review` ; `elitetraderfunding-1step-150k` ajouté, `elitetraderfunding-1step-250k` retiré (passé `active = false` par la synchro) ; `max_amount_schedule` renseigné ; Static en `equity_realtime` |
| Earn2Trade | Progression Ladder lue sur les images des articles TCP et Gauntlet Mini : même grille par taille en évaluation, LiveSim et Live. | Paliers `max_contracts.tiers` sur les 7 plans, qui sortent de `needs_review`. Reste noté : le choix LiveSim / Live du partenaire n'est pas un plan séparé |
| OneUp Trader | Dynamic Scaling Targets lus sur l'image de l'article 386. Exemple officiel du 100K funded : seuil de départ 96 500 $, même distance qu'en évaluation. Produit « Express Account » (3 jours minimum) annoncé, non couvert. | Paliers funded renseignés (micros `null`, équivalence non publiée : le schéma l'accepte désormais dans un palier) ; `needs_review` maintenu (prise en compte du latent non documentée) |
| BluSky | Prix du sélecteur de blusky.pro (Launch 59 / 69 / 79 $ par mois, Propel 150 à 320 $, Orbit 199 à 419 $ en paiement unique, Instant 599 $). Direct to Funded absent du sélecteur. | Prix renseignés sur 14 plans ; `needs_review` maintenu (contrôle en séance du Sim Funded, Buffer Zone) |
| Phidias | API du centre d'aide relue (30 articles) : la liquidation est décrite sur le « solde » / « capital » sans dire si le latent compte. Deux heures différentes : recalcul du drawdown à 22:00 UTC+2, fermeture obligatoire (Fundamental) à 21:59 UTC. | Inchangé, question au support |
| Bulenox | CMS public relu : règles du Master classique conformes au catalogue. Le Momentum Master n'a pas de drawdown chiffré à part. | Inchangé, question au support |
