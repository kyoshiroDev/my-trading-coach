# Catalogue des règles prop firm

Règles de trading des prop firms (objectif, drawdown journalier, drawdown max, consistency, taille, horaires, payouts), maintenues à la main par MTC. L'API Tradovate ne les expose pas (401 sur `accountRiskStatus` et `userAccountPositionLimit`) : on croise ce catalogue avec les vrais soldes Tradovate (`getcashbalancesnapshot` : netLiq, openPnL, realizedPnL) pour afficher l'état d'un compte prop firm en temps réel.

Statut : **en base**, tables `PropFirm` / `PropFirmPlan`, synchronisées depuis ces fichiers à chaque démarrage de l'API (`apps/api-mytradingcoach/src/modules/prop-firms/`). Pas encore d'UI ni de calcul de l'état du compte. Lire `EXTRACTION-REPORT.md` avant d'utiliser un plan marqué `needs_review`.

## Emplacement

`libs/shared/src/prop-firm-rules/`, dans la lib partagée `@mtc/shared`, parce que :

- l'API NestJS (seed, calcul de l'état du compte) et l'app Angular (affichage des seuils) liront les mêmes règles : une seule copie, pas de dérive entre front et back ;
- `libs/shared` est déjà la lib commune aux deux (`@mtc/shared`, cf. `pricing.ts`, `trade-stats.ts`) ; une lib dédiée aurait demandé un nouveau projet Nx, un alias et un tsconfig pour quatre fichiers de données ;
- les fichiers sont sous `src/` pour être importés (`resolveJsonModule`) : `catalog.ts` les expose sous `PROP_FIRM_CATALOG_FILES`, ré-exporté par `index.ts`.

Le script de validation est dans `tools/scripts/` (et non dans un `scripts/` racine) : c'est la convention du dépôt pour les scripts ponctuels (`tools/scripts/README.md`), le typecheck `tools-scripts` le couvre et `scripts/` ne contient que le bot Discord.

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.json` | JSON Schema (draft 2020-12) qui valide chaque fichier firm. |
| `<firm>.json` | Une firm par fichier, nommé d'après `firm.id` : `lucid`, `apex`, `topstep`, `tradeify`, `myfundedfutures`, `tradeday`. |
| `EXTRACTION-REPORT.md` | Sources, tableau récap, plans à revoir, contradictions. |
| `tools/scripts/validate-prop-firm-rules.ts` | Validation ajv + contrôles métier. |

## Valider

```bash
pnpm prop-firms:validate
```

Sort en code 1 au moindre écart. Contrôles : schéma, `firm.id` = nom du fichier, ids de plan uniques dans tout le catalogue et préfixés par la firm, `profit_target` < `account_size`, `max_drawdown.amount` > 0 et < `account_size`, montant de base de la DLL <= drawdown max, au moins une `source_url` par plan.

## Conventions

- **Montants** : nombres, dans la devise du compte (`currency`). Jamais `"$3,000"`.
- **Pourcentages** : décimales (`0.5` = 50 %).
- **Heures** : `"HH:MM <fuseau IANA>"`, ex. `"18:00 America/New_York"`. Les firms écrivent souvent « EST » pour l'heure de New York toute l'année : on stocke `America/New_York`.
- **`null`** : la règle n'existe pas. Si la règle existe mais que la valeur n'est pas publiée : `null` + `needs_review: true` sur le plan + explication dans `notes`. Jamais de valeur supposée.
- **Ids de plan** : `firm-plan[-options]-taille`, ex. `lucid-daily-dll-eod-50k`, `apex-intraday-100k`. Stables : un id publié ne change jamais. Si une firm change les règles d'un plan existant, on met à jour le plan ; si elle crée un nouveau produit, on crée un nouvel id.
- **Options au checkout** : quand une option change les règles (DLL ON/OFF, drawdown d'évaluation EOD ou intraday), chaque combinaison est un plan distinct, décrit par `configuration`. Une option qui ne change que le prix (ex. Apex « No Activation Fee ») reste dans `price.notes`.
- **Pas de tiret long** dans les textes.

## Champs ajoutés au format de départ

Tous documentés dans `schema.json`. Aucun champ du format de départ n'a été supprimé ni renommé.

| Champ | Pourquoi |
|---|---|
| `firm.help_center` | Source principale, pour la re-vérification. |
| `plan.availability` | `invite_only` pour les plans non vendus au public (LucidMaxx). |
| `plan.configuration` | Options du checkout qui distinguent deux plans de même taille. |
| `price.activation_fee` | Frais d'activation du compte funded (Apex), séparés du prix de l'évaluation. |
| `phase.max_duration_days` | Accès limité dans le temps (évaluations Apex : 30 jours). |
| `daily_loss_limit.tiers` | DLL par palier de profit (PA Apex). |
| `daily_loss_limit.scaling_rule` | DLL dynamique non tabulable (LucidScale : 60 % du pic de profit EOD). |
| `daily_loss_limit.notes` | Subtilités (soft breach, base non documentée, contradictions). |
| `max_drawdown.locked_floor` | Niveau du seuil une fois figé. `locks_at` reste le solde qui déclenche le blocage. |
| `max_drawdown.enforced_on` | **Critique pour le calcul** : `equity_realtime` = l'equity (P&L latent inclus) ne doit jamais toucher le seuil en séance. `null` = non documenté par la firm. |
| `max_drawdown.platform_overrides` | Blocage du trailing différent selon la plateforme (évaluations Apex : jamais sur Tradovate, au solde objectif sur Rithmic / WealthCharts). |
| `max_contracts.tiers` | Taille max par palier de profit (scaling plan). |
| `time_rules.notes` | Exceptions (marchés agricoles, jours fériés, règles news). |
| `payout.min_daily_profit` | Profit minimum pour qu'un jour compte dans `min_days`. |
| `payout.min_cycle_profit`, `min_cycle_profit_schedule` | Profit minimum entre deux payouts, fixe ou par cycle. |
| `payout.max_amount_schedule` | Plafond par numéro de payout (index i = payout i+1, la dernière valeur vaut pour les suivants ; `null` = pas de plafond pour ce payout). |
| `phase.starting_balance` | Solde de départ de la phase quand il diffère de la taille (funded à 0 $ : Topstep XFA, MyFundedFutures). Seuils exprimés dans ce référentiel. |
| `configuration.payout_path`, `configuration.addon` | Parcours de payout choisi (Standard / Consistency / Flex / Daily) et option payante qui change une règle. |
| `consistency.max_single_day_pct_schedule` | Seuil par numéro de payout (Tradeify Lightning). |
| `payout.split_by_profit` | Partage selon le profit présent sur le compte (TradeDay Quick Pay). |
| `payout.split_after` | Partage qui change au-delà d'un cumul payé par compte (`split_pct` = avant le seuil). |
| `payout.max_payouts` | Nombre de payouts avant fermeture ou passage en live. |
| `payout.safety_net_balance` | Solde sous lequel aucun payout n'est possible (buffer / safety net). |

### Lire un drawdown

- `type` : `trailing_eod` = le seuil suit le plus haut **solde de clôture** ; `trailing_intraday` = il suit le plus haut **pic intraday** (P&L latent inclus) ; `static` = il ne bouge pas.
- Seuil courant = `max(pic suivi) - amount`, plafonné à `locked_floor` une fois `locks_at` atteint (`platform_overrides[<plateforme>]` prime s'il existe).
- `enforced_on` dit ce qu'on compare au seuil en séance. À `null`, le calcul doit rester prudent (comparer l'equity) et l'UI doit le signaler.

## Ajouter une firm

1. Sources : **uniquement** le site et le help center officiels de la firm (pas de blog, comparateur, affilié, YouTube, Reddit, Discord ni résumé IA). Lister tous les plans en vente et toutes les tailles.
2. Créer `<firm-id>.json` avec `verified_at` = date du relevé. Un plan par combinaison d'options qui change les règles.
3. Pour chaque drawdown, lire la définition exacte (clôture ou pic intraday, latent inclus ou non, blocage, contrôle en séance) et la résumer dans `basis_notes`.
4. Lister toutes les pages utilisées dans `source_urls`. Marquer `needs_review` au moindre doute.
5. Ajouter le fichier à `PROP_FIRM_CATALOG_FILES` (`catalog.ts`).
6. `pnpm prop-firms:validate`, puis compléter `EXTRACTION-REPORT.md`. Le déploiement suivant de l'API le met en base.

## Re-vérifier une firm

Les firms changent leurs règles souvent (Apex a remplacé toute sa gamme le 2026-03-01, Lucid a changé la consistency Pro le 2025-11-28). À refaire au moins une fois par mois et avant chaque mise en avant d'un plan :

1. Rouvrir chaque URL de `source_urls`. Les help centers Lucid (Intercom) et Apex (WordPress) affichent une date de mise à jour par article (`dateModified` dans le JSON-LD de la page) : comparer avec `verified_at`.
2. Lucid : la liste complète des articles se lit depuis les collections de `https://support.lucidtrading.com/en/`. Apex : `https://apextraderfunding.com/help-center-sitemap.xml` liste les articles avec leur date. Les sites principaux bloquent les requêtes hors navigateur (403) : passer par un navigateur.
3. Vérifier le sélecteur de plans des pages d'accueil (tailles, options, prix).
4. Mettre à jour les valeurs, `verified_at`, puis `pnpm prop-firms:validate` et le rapport. Le déploiement suivant de l'API met la base à jour (plan retiré du JSON : `active = false`, jamais supprimé). Ne jamais changer l'`id` d'un plan publié.
