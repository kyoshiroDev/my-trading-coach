# PROMPT-653-veille-lot6 : veille des règles prop firm, lot 6

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Tri du relecteur (2026-11-26)

« 653 A lot 6 veille »

## Périmètre : relevé du 2026-11-28 (`pnpm prop-firms:watch`, lecture seule)

302 sources relues : **20 modifiée(s)**, 0 nouvelle(s), 45 illisible(s) hors navigateur. 0 firm(s) vérifiée(s) il y a plus de 30 jours.

### Articles modifiés depuis le dernier relevé

Relire l'article, mettre à jour le JSON de la firm et son `verified_at`, puis `pnpm prop-firms:validate` et `pnpm prop-firms:watch --update`.

**BluSky Trading**
- https://help.blusky.pro/en/articles/12434458-blulive-buffer-stage (modifié le 2026-11-23, relevé du 2026-11-19)

**Funded Futures Family**
- https://www.fundedfuturesfamily.com/ (contenu modifié)

**Lucid Trading**
- https://lucidtrading.com/ (modifié le 2026-09-21)

**MyFundedFutures**
- https://help.myfundedfutures.com/en/articles/17573707-comprehensive-look-into-redesigned-pro-plan (modifié le 2026-11-25, relevé du 2026-11-19)

**Take Profit Trader**
- https://takeprofittrader.com/ (contenu modifié)
- https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15169066911133-Rule-2-Do-Not-Exceed-Maximum-Position-Size (modifié le 2026-11-23, relevé du 2025-11-13)
- https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15169070804125-Rule-1-Hit-Your-Profit-Target (modifié le 2026-11-23, relevé du 2025-11-13)
- https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15170265979165-Rule-3-Do-Not-Hit-End-Of-Day-EOD-Maximum-Trailing-Drawdown (modifié le 2026-11-23, relevé du 2025-11-13)
- https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15171769361053-PRO-Account-Rules (modifié le 2026-11-23, relevé du 2026-09-22)
- https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15171820366109-How-to-Keep-Track-Of-Your-Drawdown (modifié le 2026-11-23, relevé du 2025-11-13)
- https://takeprofittraderhelp.zendesk.com/hc/en-us/articles/15172219527581-PRO-Account-Profit-Split-Withdrawal-Rules (modifié le 2026-11-23, relevé du 2026-10-09)

**Top One Futures**
- https://help.toponefutures.com/en/articles/14595016-elite-access-accounts-overview (modifié le 2026-11-26, relevé du 2026-10-27)
- https://www.toponefutures.com/ (contenu modifié)
- https://www.toponefutures.com/launchpad (contenu modifié)

**Topstep**
- https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account (modifié le 2026-11-23, relevé du 2026-06-30)
- https://help.topstep.com/en/articles/14289835-topstep-pricing-and-payment-questions (modifié le 2026-11-27, relevé du 2026-11-16)
- https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit (modifié le 2026-11-23, relevé du 2026-11-19)
- https://help.topstep.com/en/articles/8284233-topstep-payout-policy (modifié le 2026-11-24, relevé du 2026-11-22)

**TradeDay**
- https://www.tradeday.com/#pricing (contenu modifié)

**UProfit**
- https://uprofit.com/day-programs (contenu modifié)


## Règles (reprises de PROMPT-veille-regles-prop-firm.md)

Pages publiques seulement, jamais de connexion à un compte de firme ; `pnpm prop-firms:watch --update` en ne gardant dans `veille/sources.json` que les URL du lot ; plan plus vendu → `discontinued` (jamais retiré) ; règle ambiguë ou montant non publié → `needs_review` / DLL `amount: null`, jamais de valeur devinée ; tableau des changements dans la PR (plan, champ, avant → après, source, date), en tête ce qui modifie une marge affichée. Vérificateurs : nestjs, instruments, tests, angular, puis relecteur ; build landing en local (pages SEO des règles).

## Découpage du lot 6 validé par le relecteur (28/11)

Une PR par sous-lot, même circuit ; `pnpm prop-firms:watch --update` ne garde dans `veille/sources.json` que les URL des firmes de la PR ; specs de veille existantes adaptées aux renommages sans affaiblir d'assertion ; nouveaux tests dans `veille-2026-11-28-lot6a/6b/6c.spec.ts`. Vérificateurs : nestjs, angular, tests, instruments, puis relecteur ; build landing en local.
- **6a, Take Profit Trader seul** : les 5 plans d'origine renommés « Test (achat avant le 23/11/2026) », ids et règles inchangés, restent `public` (75K et 100K compris : `discontinued` bloquerait la liaison d'un compte acheté avant, convention « version remplacée ») ; 9 nouveaux plans `takeprofittrader-{intraday|classic|eod}-{25|50|150}k` (« Intraday », « Classic », « EOD »), prix 110/150/360, 150/170/465, 160/209/499 $/mois, resets dans `price.notes`, drawdown par phase (Intraday intraday/intraday ; Classic EOD en Test, intraday en PRO ; EOD EOD/EOD), PRO+ dans les notes du payout ; DLL du parcours EOD (500/1000/2500) `breach: "account_failed"` avec soft / hard breach en `notes` (à faire confirmer par instruments) ; en notes sans nouveau champ : plafond de profit/jour en PRO (10 000, 5 000 pour EOD), positions opposées interdites, robots interdits en PRO, copy trading autorisé, inactivité funded d'un jour par mois ; plans d'origine : valeurs du lot 2 gardées, règle nouvelle reportée seulement si un article dit qu'elle vaut pour les comptes existants, sinon note « règles relevées le 22/11/2026 » ; tableau de la PR : 25K (DD 1500 → 1000) et 150K (15/150 → 12/120) en tête ; test de `matchPlans` ambigu à 50K (Test d'origine vs Classic).
- **6b, Top One et MyFundedFutures** : X-HYPER (prix 158/218/298, micros / jours gagnants / partage en null + `needs_review`), Elite Access 4 % vs 6 % : `needs_review`, montants de l'article (6 %) inchangés, les deux sources en notes ; MFF « Pro 50K One Day » (`price.amount: null`, note « prix non publié au 28/11/2026 », `needs_review` seulement si la phase funded n'est pas décrite), note « un compte Sim Funded Pro actif par taille », phrase « retrait unique jusqu'à 60 % » retirée si non sourcée.
- **6c, FFF puis notes et `verified_at`** : FFF renommée « Funded Family One » seulement si la continuité est prouvée (help center, « formerly », mentions légales), id `fundedfuturesfamily` inchangé ; prix Velocity 179/265/475/675 et Prime 50K 204 (facturation vérifiée) ; « Premier+ Fast Pass » non ajouté (ligne au rapport) ; notes BluSky et Topstep (Back2Funded 599/699/829 dans `price.notes` du XFA) ; `verified_at` au 2026-11-28 pour TradeDay, UProfit, Topstep, BluSky ; accueil Lucid relu dans Chrome ; UProfit « Zero 30k » : ligne dans `EXTRACTION-REPORT.md`.
- Seed démo : rien (comptes démo sur Apex, Tradeify, Elite).
