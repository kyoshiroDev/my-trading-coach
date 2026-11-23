# Payouts d'un compte funded

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Payouts saisis à la main (feature payouts, partie 1, 2026-10-21) · 2026-10-21 -->
> **Origine** : `nestjs.md` · « Payouts saisis à la main (feature payouts, partie 1, 2026-10-21) » · 2026-10-21

## Payouts saisis à la main (feature payouts, partie 1, 2026-10-21)

Un compte FUNDED **sans connexion broker** n'a aucune trace de ses retraits : l'utilisateur les saisit
(date + montant). Ils vivent dans `BrokerPayout`, comme les payouts détectés chez Tradovate, avec
`changeType = 'manual'` et `transactionId = 'manual:<uuid>'` (**pas de migration**). Logique pure :
`accounts/account-payouts.ts` (`MANUAL_PAYOUT_TYPE`, `summarizePayouts`, `manualPayoutError`).

- Routes : `GET /accounts/:id/payouts` (détectés et saisis, `manual` pour les seconds),
  `POST /accounts/:id/payouts` (`CreatePayoutDto` : `tradeDate` `AAAA-MM-JJ` ≤ aujourd'hui, `amount` > 0 ;
  compte FUNDED seulement, 400 sinon ; **409 `PAYOUTS_FROM_BROKER` si le compte a une connexion**,
  sinon le retrait compterait deux fois), `DELETE /accounts/:id/payouts/:payoutId` (payout SAISI
  seulement, 404 sinon). `dismiss` (« ce n'était pas un payout ») ne s'applique qu'aux payouts détectés.
- Solde : `tradesBalance = solde de départ + P&L des trades − Σ payouts saisis` (`RulePayouts.manualTotal`).
  Les payouts détectés n'en sont pas retirés : le solde lu chez le broker les a déjà perdus. Le plancher
  ne bouge pas (le plus haut vient des trades), donc la marge baisse du montant retiré.
- Cycle du prochain payout : le plus récent entre le dernier payout enregistré (détecté ou saisi) et la
  date du formulaire ; `cycleSource = 'manual'` quand c'est un payout saisi (pas de `lastPayout` à écarter).
- Courbe d'équité journalière : les payouts saisis sont lus avec les autres (même table, non mis en cache).
- La synchro Tradovate ne supprime que ses lignes `balancedrop`, et tient compte des dates de payouts
  connues (saisies comprises) pour ne pas détecter deux fois le même retrait.
- Tests : `account-payouts.spec.ts`, `account-payouts.int-spec.ts` (solde, marge, courbe, 409, 404, 400).

<!-- Origine : angular.md · Payouts d'un compte funded (feature payouts, partie 1, 2026-10-21) · 2026-10-21 -->
> **Origine** : `angular.md` · « Payouts d'un compte funded (feature payouts, partie 1, 2026-10-21) » · 2026-10-21

## Payouts d'un compte funded (feature payouts, partie 1, 2026-10-21)

`features/accounts/account-payouts` (`mtc-account-payouts`, entrées `accountId`, `currency`, `connected`,
sortie `changed`) : au dépli d'un compte FUNDED dans Mes comptes (la ligne a alors `has-detail`). Liste
des payouts (`AccountsApi.listPayouts`) : « saisi » (supprimable, `ConfirmService`, 404 = succès) ou
« détecté chez le broker ». Compte sans connexion : formulaire date (max aujourd'hui) + montant →
`addPayout` ; compte connecté : pas de saisie (l'API répondrait 409). `changed` → `store.load()` : solde,
marge et cycle repartent du serveur. Note du cycle : `cycleSource === 'manual'` → « saisi dans la liste
des payouts ». En spec (JIT), remplacer les signaux d'`input()` sur l'instance (`setInput` échoue).
Gel du plancher au premier payout (#696, remplace la note `payouts-floor-lock-note` de #695) : entrée
`floorLock` (= `metrics.drawdown.rule.locksOnFirstPayout`). Le premier payout connu (plus ancien payout
détecté ou saisi, ou `lastPayoutAt` du compte, dates ≤ aujourd'hui) fige le plancher côté API
(`firstPayoutDay`, `lockedBy: 'payout'`, `payoutLockedSince`). `floorLock === 'request'` → note
`payouts-floor-lock-request` : la firm fige dès la demande, donc tant que le payout n'apparaît pas,
le plancher réel peut être plus haut que l'estimation. Texte du formulaire : plus de « Le plancher ne
bouge pas » ; avec `floorLock`, phrase sur le gel à la date du premier payout enregistré.
