# Alertes prop firm « avant la casse » (#370)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Alertes prop firm « avant la casse » (#370, PREMIUM) · 2026-10-04 -->
> **Origine** : `nestjs.md` · « Alertes prop firm « avant la casse » (#370, PREMIUM) » · 2026-10-04

## Alertes prop firm « avant la casse » (#370, PREMIUM)

- **Perte journalière** : `accounts/daily-loss.ts` (pur, testé). Journée = `tradingDay` (CME, 17:00 CT
  = 18:00 ET, le reset de toutes les firms qui en publient un). Référence = clôture officielle de la
  séance précédente (`BrokerDailyClose`, dernière ligne par compte) quand elle est à jour et dans le
  référentiel du compte, sinon solde − P&L des trades du jour. Base `equity` sauf `basis: 'balance'`
  (base non publiée → equity, le plus prudent). Paliers selon le profit de la veille, jamais sous le
  palier 1. `scaling_rule` (LucidScale…) NON modélisée → `approximate: true`.
- `AccountsService.list(userId, { premium })` : le contrôleur passe `isPremiumAccess(user)` (perte journalière + gain max du jour).
- **Alertes** : `PropAlertsService` (module Tradovate), déclenché par le gateway `/tradovate-live`
  sur chaque `tradovate:balance` (worker titulaire, donc une seule évaluation), regroupé 1,5 s par
  compte. Réutilise `AccountsService.list` (aucune règle recalculée). Niveaux : ≤ 25 % de marge →
  `warning`, ≤ 10 % → `critical`, dépassé → `breached`, pour `drawdown` et `daily_loss`. Clé Redis
  `prop-alert:<compte>:<type>:<journée>` = plus haut niveau envoyé (TTL 2 j) ; réarmée quand la marge
  remonte au-dessus de 35 % (hystérésis). Hors Premium, démo ou compte non ACTIVE : rien.
- **Consistency (2e partie)** : `progress.requirements[consistency]` porte, pour le Premium
  (`today` passé à `computeProgress`), `dayCap` = gain max de la journée pour qu'elle reste sous la
  limite (`c · P0 / (1 − c)`, P0 = profit des autres journées du cycle ; null si P0 ≤ 0) et
  `todayPnl`. Alerte `consistency` : `warning` à 80 % du gain max, `breached` au-delà (avec
  `extraProfit` = profit à rattraper), réarmée sous 60 %.
- **Bonnes nouvelles** : `objective` / `payout` au niveau `reached` quand `progress.done`, UNE fois
  par cycle (clé `prop-alert:<compte>:<type>:cycle-<cycleAfter|start>`, TTL 120 j).
- **Anti-tilt (#371)** : `TiltAlertsService` (module Tradovate), déclenché par le gateway sur
  `tradovate:trades` **source `live` seulement** (pas le rattrapage à l'ouverture : un nudge après
  coup n'a plus de sens). Détection pure dans `tilt-detection.ts`, sur le DERNIER trade du jour,
  avec les seuils de la note comportementale (`execution-grade.util`) : `revenge` = clôture < 2 min
  après la clôture de la dernière perte du jour (clôture à clôture : les trades synchronisés n'ont
  que l'heure de clôture) ; `size` = taille > 2× la médiane juste après une perte (≥ 20 trades
  d'historique) ; `overtrading` = trades du jour > 2× la médiane des journées et ≥ 6 (≥ 10 journées).
  Événement `tilt:alert` avec l'humeur de pré-session de la session ouverte. Dédoublonnage Redis
  `SET NX` par signal et par trade (par journée pour le surtrading). Premium, hors démo.
- **Journal de séance (#373)** : `PropRiskJournalService` (module Tradovate) — appelé par
  `PropAlertsService` (relevé des marges + alertes envoyées) et `TiltAlertsService` (épisodes de
  tilt). Injecté en `@Optional()` : best-effort, un échec est journalisé sans bloquer l'alerte.
- **IA (#374)** : `PropRiskContextService` (module Comptes, exporté) construit un bloc texte de
  FAITS déjà calculés (métriques Premium des comptes actifs + `AccountRiskDay` + `PropRiskEvent`),
  `forDay` pour le récap 17h30 (`generateDailyOneLiner({ propContext })`), `forWeek` pour le Weekly
  Debrief (`buildDebriefPrompt({ propContext })`). Consigne aux prompts : ne rien recalculer, aucun
  chiffre officiel, et le récap parle EN PRIORITÉ d'une limite approchée, d'une alerte ou d'un tilt.
  Heures affichées à Paris. Injecté en `@Optional()` dans les deux services ; contexte indisponible
  → l'IA part sans le bloc.
- **Récap du jour : ce que voit l'IA (2026-10-09, récap faux de Val)** :
  - `forDay(userId, date, tradedAccountIds)` : SEULS les comptes tradés ce jour-là, avec ou sans
    règle prop firm dès qu'ils ont une alerte / un tilt du jour. Sinon un compte cassé deux jours
    plus tôt et pas tradé passait pour la casse du jour, et le tilt d'un compte sans règle disparaissait.
  - Casse du drawdown d'un jour précédent → datée (« dépassé depuis le mercredi 7 octobre (pas
    aujourd'hui) »), via le dernier `PropRiskEvent` drawdown/breached avant la période.
  - Chaque ligne de trade porte son compte (`« label »`), et la consigne interdit d'attribuer un fait
    d'un compte aux trades d'un autre.
  - Setup `IMPORT_SETUP_TITLE` (« Sans setup », défaut des imports) → « setup non renseigné », et
    l'IA n'en tire aucune conclusion (elle reprochait « sans setup » à chaque journée synchronisée).
  - Comptes d'entraînement exclus du récap (P&L, stats, patterns 7 j, IA) : `demoAccountIds`
    (`accounts/demo-accounts.ts`) = type `DEMO` OU relié à un compte de démo Tradovate
    (`externalAccountName` = `DEMO` + chiffres), quel que soit le type saisi.
- ⚠️ Limite connue : le latent n'est relu qu'aux événements de trade (pas de cotations, pas de
  boucle sur l'instantané) : une position ouverte qui glisse n'alerte qu'au trade suivant.
  **Choix produit du 2026-10-06 (Greg)** : on garde « jamais en boucle » (la doc Tradovate dit
  « many times in succession is an anti-pattern »), le latent est **daté** à l'écran.
- **Positions ouvertes décrites** (retour Val, `docs/audit-live-tradovate.md`) : un `Trade` ne naît
  qu'à la sortie (paire de fills). Chaque synchro (donc chaque événement `position` du WebSocket)
  écrit le détail des positions non nulles du compte (actif normalisé, sens, quantité, `netPrice`,
  `timestamp`) dans Redis `tradovate:positions:<connexion>` (TTL 12 h, `tradovate-open-positions.ts`,
  `TradovateBalanceService.recordOpenPositionDetails`). `GET /session/today/stats` renvoie `broker`
  (`LiveBrokerState`, `@mtc/shared`) pour le compte de la session active : positions, latent broker
  et leurs dates ; `null` si compte non synchronisé. Latent inconnu avec position → `openPnl: null`
  (jamais un chiffre inventé) ; à plat → 0. Le total de session reste le RÉALISÉ : le latent est à
  part.
- **SL / TP des positions (ordres actifs, #601)** : le WebSocket souscrit aussi `order` +
  `orderVersion` (`ORDER_ENTITY_TYPES`, permission `Orders:Read` déjà accordée, **lecture seule**).
  `order` porte le lien (`parentId`, `ocoId`, `ordStatus`), `orderVersion` le type et les prix : il
  faut les deux. Carnet en mémoire par connexion (`tradovate-orders.ts`, remis à zéro à chaque
  instantané `user/syncrequest`), ne garde que `Working` / `PendingReplace` ; regroupé 500 ms puis
  écrit dans Redis `tradovate:orders:<connexion>` (TTL 12 h) **seulement s'il change** → événement
  front `tradovate:orders`. `0` appel REST : la Trade API ne garde les ordres que pendant la séance.
  `getLiveBrokerState` relie via `protectionFor` (position Redis porte `contractId`) : même contrat,
  sens opposé, SL = stop sous l'entrée d'un LONG (`stopPrice`), TP = `Limit` au-dessus (`price`) ;
  **plusieurs candidats sans lien de bracket → `null`** (jamais une association devinée). Mapping
  jamais validé sur un vrai bracket : trames `order` / `orderVersion` brutes en `logger.debug`.
  **#963** : le WebSocket souscrit aussi `orderStrategyLink` (type inconnu = ignoré sans erreur, doc
  user/syncrequest). Liens lus dans l'instantané sous `orderStrategyLinks` (clé NON documentée,
  absente = vide) et en direct ; carnet `strategies` (un lien arrivé avant son ordre est gardé,
  purgé avec l'ordre, ignoré après sa sortie, mémoire `closed` bornée à 1 000 ; `Deleted` par id
  seul du lien retrouvé via l'index `links`). `WorkingOrder.strategyId`
  (ancienne valeur Redis sans le champ = null) ; `sameBracket` relie aussi par même stratégie, jamais
  null = null. Effet : cas MIXTES résolus (bracket complet + ordre isolé ou jambe orpheline) ; deux
  brackets COMPLETS restent `null` (règle stricte). Mesure : log « Liens de stratégie Tradovate WS
  <conn> : n à l'instantané, clés reçues [...] » à chaque instantané, et un log au premier lien reçu
  en direct par connexion.
