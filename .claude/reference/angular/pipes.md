# Pipes obligatoires

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Pipes obligatoires — ne jamais dupliquer la logique · 2026-04-25 -->
> **Origine** : `angular.md` · « Pipes obligatoires — ne jamais dupliquer la logique » · 2026-04-25

## Pipes obligatoires — ne jamais dupliquer la logique

```typescript
// Toujours utiliser les pipes, jamais de logique inline
PnlColorPipe      // couleur verte/rouge selon pnl
PnlFormatPipe     // montant signé dans la devise NATIVE du compte : {{ t.pnl | pnlFormat : t.entry : t.accountId }}
MoneyPipe         // idem avec décimales / sans « + » : {{ pnl | money:0 }}, {{ fees | money:2:false }}
EmotionEmojiPipe  // emoji selon état émotionnel
SessionLabelPipe  // label lisible de la session
SetupColorPipe    // couleur selon setup
EcoValuePipe      // valeur d'annonce éco + unité : {{ e.actual | ecoValue: e.unit }} → « 4.1 % », « 250K » (formatEcoValue en .ts, #1179)
```

**Séparateur décimal (#1180)** : point pour les chiffres de trading (%, P&L, prix, indices, annonces éco), milliers en espace (fr-FR + `.replace(',', '.')`) ; décimale au point comme `formatMoney`. Les montants d'abonnement en € restent au format fr-FR.

**Devise = propriété DU COMPTE, ZÉRO conversion, AUCUNE préférence globale** (PROMPT-213/214) :
un montant s'affiche dans la devise de son compte de trading (`TradingAccount.currency`), tel que
reçu — un compte prop firm en USD s'affiche en USD pour tout le monde. Source UNIQUE front + back :
`@mtc/shared` (`libs/shared/src/currency.ts`) — `ACCOUNT_CURRENCIES` (USD, USDT, EUR : sélecteurs
de l'onboarding et de la page Comptes, validation API), `formatMoney(value, currency)` (`$1.00`,
`€1.00`, `1.00 USDT` : code APRÈS le montant pour les devises sans symbole ; signe de la valeur
AFFICHÉE : jamais `-$0`), `commonCurrency`. **Arrondi** : au plus proche, demi vers l'extérieur
(49 911,50 → `$49,912`, -1,50 → `-$2`) ; un montant non nul sous 1 en valeur absolue garde ses
centimes même à `decimals: 0` (-0,80 → `-$0.80`, jamais `-$1`). C'est le SEUL formateur d'argent :
pas de `Math.floor/round`, `toFixed` ni `Intl` à côté (`compactMoney` des axes passe par lui sous 1000).
Tests de référence : `libs/shared/src/currency.spec.ts`, `core/services/money-rounding.spec.ts`.
- **Totaux de l'écran** : `MoneyService.format()` / pipes → `SelectedAccountStore.displayCurrency`
  (compte sélectionné, sinon devise commune de « Tous les comptes »).
- **Ligne de trade** : devise de SON compte → passer l'`accountId` (`pnlFormat : entry : accountId`,
  `MoneyService.formatFor`). `Trade.accountId` est exposé par l'API.
- **Devises mêlées en « Tous les comptes »** (`MoneyService.mixed()`) : pas de totaux (on
  n'additionne pas des USD et des EUR) → `<mtc-mixed-currency-notice />` (« choisis un compte ») à
  la place des KPI / courbes / calendrier (dashboard, analytics, résumé et totaux jour/semaine du
  journal) ; les lignes de trades restent, chacune dans sa devise. Formateur avec devise `null` →
  aucun symbole, jamais un symbole deviné.
- **Compte synchronisé** : devise imposée par le broker, sélecteur désactivé (`formSynced`) et refusé
  côté API. Onboarding : le choix USD / USDT / EUR est la devise du compte créé, rien au profil.
- **`User.currency` / `User.currencyRate` n'existent plus côté front** (plus de réglage « Devise
  d'affichage », plus de taux) : ne jamais réintroduire de conversion. **Jamais de `$` en dur**
  dans un template, un graphe Chart.js (`ChartService`) ou un libellé calculé (récaps d'import
  compris : devise du compte cible).

**P&L affiché = net** : un montant par trade se lit via `netPnl(t)` de `@mtc/shared`
(`pnl` brut − frais), jamais `t.pnl` brut (tableau des trades récents, live feed). Les agrégats de
l'API sont déjà nets. Le formulaire de trade envoie le **brut** (`form().pnl ?? autoPnl()`) et la
commission à part : envoyer `pnlNet` faisait déduire les frais deux fois.

**Courbe d'équité / drawdown** : composant partagé `mtc-perf-chart` (dashboard + analytics, style
dans `design.md`) → `ChartService` ; séries dans `chart-series.util.ts`, qui préfixe un point
« Départ » : un seul jour tradé trace déjà la courbe (`curve.length >= 1`). Les bornes de période
envoyées à l'API sont des horodatages ISO complets.

**Capital, courbe et drawdown : une seule définition** (`core/services/equity-period.util.ts`) :
- **Capital** (KPI du dashboard) = solde actuel de la vue (`viewBalance(…, 'currentBalance')`) : le
  même que le sélecteur de compte et Mes comptes (solde du broker pour un compte connecté). Jamais
  « capital de départ + P&L de la période ». Le % compare au solde du début de la période.
- **Courbe d'équité** : part de `periodStartBalance` = solde de départ + P&L d'avant la période
  (`before.pnl`), soit la taille du compte quand la période couvre son début (`before.count === 0`).
  Repli sans `before` (API ancienne) : solde actuel − P&L de la période. Un écart entre P&L 30 jours
  et P&L total = des trades avant la fenêtre, pas une erreur. **Jamais `startingCapital` de `/equity-curve/daily`** : c'est le capital du
  PROFIL (un compte de 50K partait de 100K dans Statistiques).
- **Drawdown max du tableau de bord** (KPI + sparkline) = règle unique `maxDrawdownOfTrades` /
  `maxDrawdownOfCumulative` de `@mtc/shared` : plus grand écart sommet → creux qui suit, sur le
  solde APRÈS CHAQUE TRADE CLÔTURÉ de la période (net des frais, solde du début de période = premier
  sommet, trades du même instant regroupés en une étape). Valeur = `maxDrawdown` de
  `/analytics/equity-curve/trades` (toutes les clôtures, avant réduction). Libellé : « trades
  clôturés », jamais de précision intra-trade.
  **Vue « Tous les comptes » à plusieurs comptes** (`isMultiAccountView`, `drawdown-scope.util.ts`,
  PROMPT-drawdown-max-par-compte) : la valeur est le PIRE drawdown parmi les comptes (API,
  `maxDrawdownAccountId`), sous-titre « sur le compte {nom} · période » (« sur les trades sans compte »
  si besoin, `drawdownScopeLabel`), sparkline masquée et remplacée par « Choisis un compte pour voir
  la courbe » (la courbe additionne les comptes : ce n'est le drawdown d'aucun). Repli sans valeur API
  en multi-comptes : 0, jamais une série mélangée. Champ absent (ancien cache, 5 min) : sous-titre
  standard, aucune erreur. Un seul compte dans la vue « tous » : comportement d'un compte, SAUF s'il
  y a aussi des trades sans compte dans la période (#940) : `isMultiAccountView(id, comptes,
  maxDrawdownAccountCount)` lit le nombre de groupes renvoyé par `/equity-curve/trades` (dashboard :
  `equityCurveResource`, Statistiques : `tradesData`), vrai dès 2 séries ; champ absent (ancien
  cache) → règle des comptes seule. La courbe d'équité du dashboard est PAR TRADE
  (`/equity-curve/trades`, ≤ 500 points, pics et creux gardés ; payouts par `withPayoutsByTrade`,
  infobulle « Trade » / « N trades » avec l'heure). Axe X : repères posés par `dateTickIndices` (premier
  point de chaque date, 7 au plus, 4 en étroit, premier et dernier gardés) dans `afterBuildTicks`,
  `autoSkip: false` ; ne pas revenir à des libellés vides + auto-saut (le 06/11 disparaissait).
- **Carte drawdown des Statistiques** : sans plan relié, même règle (`drawdownSeries` =
  `maxDrawdownOfCumulative` sur les points de `/equity-curve/trades`, `drawdownPoints`) → même
  chiffre que le KPI du dashboard. Plan prop firm relié : courbe journalière + `floorSeries`
  (plancher du plan, `before.peak`), inchangé. `anchoredDrawdown` n'existe plus. Vue multi-comptes :
  points vides, en-tête `worst` de `mtc-perf-chart` (« Max -$X » + « sur le compte {nom} ») et message
  « Choisis un compte pour voir la courbe ».
- **Vocabulaire du drawdown** (`DRAWDOWN_LABELS`, source unique `libs/shared/src/drawdown-labels.ts`
  partagée avec la landing ; `core/constants/drawdown-labels.const.ts` n'est qu'un ré-export,
  verrouillé par son spec) :
  « Drawdown max » = baisse mesurée ; « Marge avant le plancher » = distance solde → plancher (ce que
  les firms appellent « drawdown ») ; « Règle de drawdown » = taille de la règle (ex. 2 000 $), jamais
  « Drawdown max ». Infobulle `mtc-info-tooltip` avec le texte de la constante sur chaque libellé
  (fiche règles du plan, formulaire du compte, onboarding, débrief, séance). Carte « À surveiller » de
  Mes comptes : « proche du plancher » (#939).
- **Payouts reçus** (détectés chez le broker, `payouts` + `before.payouts` de l'API) : `withPayouts`
  les insère dans les points (jour sans trade = point au même P&L, champ `payout`). Seules les
  courbes de SOLDE les déduisent : équité, marge de la carte drawdown (`floorSeries`), sparkline du
  Capital (`payoutSeries`). Elles finissent ainsi sur le Capital, et la marge baisse le jour du
  payout au lieu de sauter au dernier point. Le P&L (KPIs, « Jour », drawdown « sous l'eau ») ne les
  voit jamais : un retrait n'est pas une perte. Le plus haut d'avant la période n'est pas abaissé par
  un payout (plancher inchangé). Comptes manuels : aucun payout (pas de saisie à ce jour).
