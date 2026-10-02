# Rapport d'extraction : règles prop firm (PROMPT-136)

Relevé du 2026-10-02. Sources : sites et help centers officiels uniquement. Issue GitHub : #267.

**À lire en premier** : tous les plans Lucid sont en `needs_review`, pour trois questions transverses qu'une seule question au support Lucid peut trancher (voir « Plans à revoir »). Les 8 plans Apex sont complets.

## Résumé

| Firm | Programmes en vente | Tailles | Plans dans le catalogue | `needs_review` |
|---|---|---|---|---|
| Lucid Trading | LucidFlex, LucidPro, LucidDaily, LucidDirect, LucidMaxx (sur invitation) | 25K, 50K, 100K, 150K | 40 | 40 |
| Apex Trader Funding | Intraday Trail, EOD Trail | 25K, 50K, 100K, 150K | 8 | 0 |

Pourquoi 40 plans Lucid : les options choisies au checkout changent les règles, donc chaque combinaison est un plan.
- LucidFlex et LucidPro : DLL ON ou OFF (2 x 4 tailles chacun).
- LucidDaily : DLL ON ou OFF x drawdown d'évaluation EOD ou intraday (4 x 4 tailles).
- LucidDirect et LucidMaxx : sans option (4 tailles chacun).

Exclus volontairement :
- **LucidBlack** : collection « Legacy » du help center, plus en vente.
- **Comptes live Lucid** (LucidLive) : on n'y entre pas par achat, Lucid y fait passer les traders (après le payout 5 ou sur décision de l'équipe risque). Règles notées dans `notes` ; à modéliser si MTC suit ces comptes.
- **Produits « Legacy » Apex** : plus vendus depuis le 2026-03-01. **Attention** : des utilisateurs peuvent encore détenir des comptes Legacy (évaluations et PA), qui suivent d'autres règles. Ils ne sont pas couverts.
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

1. **Le MLL EOD est-il contrôlé en temps réel sur l'equity ?** Lucid décrit le calcul du seuil (plus haut solde de clôture) et précise, pour LucidDaily, que le P&L latent n'entre pas dans le calcul EOD. Il ne dit nulle part si une perte latente qui fait passer l'equity sous le MLL en séance liquide le compte. Apex, lui, le dit explicitement. C'est la question la plus critique pour l'alerte de liquidation. Dans le catalogue : `enforced_on: null` pour tous les drawdowns EOD Lucid. Concerne Flex, Pro, Direct, Maxx et les évaluations LucidDaily EOD. Les drawdowns intraday LucidDaily sont documentés (P&L latent inclus).
2. **Base de la DLL** (réalisé seul ou réalisé + latent) : non documentée. `basis: null` sur toutes les DLL Lucid. Impact limité : la DLL Lucid est un soft breach (pause jusqu'à la session suivante, le compte reste actif).
3. **Heure de reset de la DLL** : Lucid dit « jusqu'à la prochaine session ». `resets_at` est fixé à 18:00 America/New_York, déduit de l'article Allowed Trading Times (reprise à 18:00). C'est une déduction, pas une phrase explicite.

En attendant, le calcul MTC doit traiter un `enforced_on: null` comme `equity_realtime`, le cas le plus prudent, et l'afficher comme une estimation.

### Lucid : raisons propres à certains plans

| Plans | Raison |
|---|---|
| `lucid-flex-dll-*` (4) | Montant de la DLL en funded non publié (`amount: null`). La page Customization dit que l'option s'applique aussi au funded ; seul le montant d'évaluation est affiché. |
| `lucid-pro-dll-25k` | Contradiction de sources sur la DLL 25K, voir plus bas. |
| `lucid-daily-*` (16) | Heure de clôture obligatoire non documentée : l'article Allowed Trading Times ne cite que Pro, Flex et Direct. `must_close_by: null`. |
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
