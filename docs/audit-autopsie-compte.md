# Audit — Autopsie d'un compte grillé (#669)

> Plan validé par Greg le 2026-10-22 (§ 4 et § 5). Branche `feat/669-autopsie-compte` depuis
> `origin/dev` (worktree `../mtc-669`). Trois phases, une PR vers `dev` par phase, sans merge :
> 1. API et tests · 2. application · 3. démo et documentation. OK de Greg entre chaque phase.

## 1. Ce qui existe déjà

| Brique | Fichier | Ce qu'on en tire |
|---|---|---|
| Métriques de règles (plancher, marge, perte du jour) | `apps/api-mytradingcoach/src/modules/accounts/accounts.service.ts` (`computeRuleMetrics`) | `drawdown.breached` est calculé **pour tous les plans** ; `dailyLoss` **seulement en Premium** (`options.premium`). |
| Plancher atteint | `accounts/account-retry.ts` (`isFloorReached`) + bandeau front `features/accounts/lost-account/floor-reached-banner` | Le front sait déjà qu'un compte ACTIF a franchi son plancher ; l'user confirme ensuite « Échoué » (#677/#681). |
| Alertes en direct | `integrations/tradovate/prop-alerts.service.ts` | Premium, app ouverte, compte Tradovate : niveaux `warning → critical → breached` sur `drawdown` et `daily_loss`, une fois par niveau et par jour (clé Redis). |
| Journal de séance | `integrations/tradovate/prop-risk-journal.service.ts` → `PropRiskEvent`, `AccountRiskDay` | Heure de chaque alerte envoyée, marge la plus basse et quand, plancher début/fin. |
| Anti-tilt | `behavior/behavior-alerts.service.ts` → `BehaviorAlert` | Alertes `A1…C3` datées, par compte et par journée CME (`tradeDay`). |
| Contexte IA prop firm | `accounts/prop-risk-context.ts` | Mise en forme texte des faits (« l'IA commente, elle ne calcule jamais ») : réutilisable pour le prompt. |
| IA | `ai/ai.service.ts` | Appels plafonnés (`max_tokens` 200 → 1024), coupés hors prod par `AI_ENABLED`. |
| E-mails | `resend/` + `User.notificationsEmail`, `User.serviceEmailsOptOutAt` | Préférence e-mail existante (utilisée par le débrief hebdo). |
| Démo | `admin/demo-data/lost-accounts.ts` | Compte « Apex 50k · Éval #1 » déjà ÉCHOUÉ (−2 210 $ pour 2 000 $ de drawdown) : support naturel de l'incident d'exemple. |
| Notifications push trader | #666 | **Pas livré.** |

**Limites des données** (déjà documentées dans `behavior-replay.ts`) : l'heure d'entrée d'un trade
n'est pas en base, `Trade.tradedAt` = première sortie ; la perte latente n'est connue qu'en direct
(`AccountRiskDay`). La chronologie reconstruit donc la distance à la limite **trade par trade, en
réalisé** — estimation, affichée comme telle.

## 2. Proposition technique

### Modèle (migration Prisma)
```prisma
model AccountIncident {
  id           String         @id @default(cuid())
  userId       String
  accountId    String
  account      TradingAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  /// `drawdown` · `daily_loss`
  kind         String
  /// Journée CME du franchissement.
  tradeDate    DateTime       @db.Date
  /// `live` (alerte Tradovate) · `sync` (détecté après synchro/import) · `status` (compte marqué Échoué)
  source       String
  /// Chiffres au franchissement : limite, plancher, marge, solde.
  data         Json
  /// 3 constats factuels, calculés (zéro IA), figés à la création.
  findings     Json
  aiAnalysis   String?
  aiGeneratedAt DateTime?
  emailedAt    DateTime?
  seenAt       DateTime?
  createdAt    DateTime       @default(now())

  @@unique([accountId, kind, tradeDate])
  @@index([userId, createdAt])
}
```
`@@unique` = garde-fou « un seul incident » côté base (création en `createMany … skipDuplicates`
ou `upsert` vide, jamais de doublon même si plusieurs déclencheurs tirent en même temps).

### Détection (module `accounts/incidents/`)
`AccountIncidentsService.detect(userId, accountId, source)` : relit les métriques via
`AccountsService.list` (aucun calcul de règle dupliqué) et crée l'incident si `breached`.
Trois déclencheurs :
1. **Direct** : `PropAlertsService.check`, quand un niveau `breached` est émis (Premium, app ouverte).
2. **Après synchro / import** : fin de synchro Tradovate et fin d'import CSV → `detect` (tous plans,
   drawdown seulement en Free puisque `dailyLoss` n'est calculé qu'en Premium).
3. **Compte marqué Échoué** (`PATCH status=FAILED`) : crée l'incident drawdown s'il n'existe pas, daté
   de la dernière journée tradée — couvre les saisies manuelles et les comptes sans règles complètes.

Tous excluent `isDemo` (la démo a son incident seedé). Pas de cron : les trois points couvrent les cas
sans scanner toute la base.

### Chronologie (pure, `incident-timeline.ts`, testée seule)
Calculée **à l'affichage** depuis la base (pas d'IA, pas de stockage) pour la journée de l'incident :
- trades du compte (`tradedAt`, sens, actif, `quantity`, `pnl`), marge restante après chaque trade ;
- `BehaviorAlert` + `PropRiskEvent` du jour, intercalés par heure ;
- **alerte ignorée** = au moins un trade daté après l'alerte, même journée → badge « trade après l'alerte » ;
- taille : quantité de chaque trade + écart à la médiane du compte (même médiane que le barème B).

### 3 constats (déterministes, figés à la création)
Choisis parmi un catalogue de gabarits chiffrés, par ordre de poids, par ex. :
- « 4 trades pris après la première alerte, pour −1 120 $ » ;
- « Taille passée de 2 à 6 contrats après la 2e perte » ;
- « 70 % de la perte du jour réalisée en 25 minutes » ;
- « Marge sous 10 % dès 10 h 42, plancher franchi à 11 h 05 ».
Aucun conseil d'achat/vente, aucune promesse ; phrases au constat.

### Analyse IA (Premium)
Un appel **au plus** par incident : généré à la **première ouverture** par un Premium (pas à la
détection : on ne paie que les autopsies lues, et les trades de la journée sont tous synchronisés),
persisté dans `aiAnalysis`, jamais régénéré. `max_tokens` 400, prompt = faits de la chronologie +
constats (même règle que `prop-risk-context` : l'IA commente, ne calcule pas). Coupé si `AI_ENABLED`
faux. Garde-fou concurrence : verrou Redis `incident-ai:<id>` pour éviter deux appels simultanés.

### API
- `GET /accounts/:id/incidents` → liste (badge sur la carte du compte).
- `GET /incidents/:id` → incident + chronologie + constats + `aiAnalysis` (génère l'IA si Premium et absente).
- `PATCH /incidents/:id/seen` → `@DemoAllowed()` non nécessaire (bloqué en démo, sans effet visible).

### Front (mobile first, 390 px)
- Page `/accounts/:id/autopsie/:incidentId` : en-tête (compte, limite, heure du franchissement),
  3 constats, chronologie verticale (heure · trade · taille · marge restante · alertes), bloc IA
  (Premium) ou teaser cadenas (Free), disclaimer « estimation MyTradingCoach ».
- Entrées : lien « Voir l'autopsie » sur la carte d'un compte ÉCHOUÉ / dans le bandeau « Plancher
  atteint » et dans la feuille « compte perdu ».

### Notification / e-mail
- #666 non livré → **dans l'app** pour l'instant (badge « Autopsie disponible » + entrée dans le
  bandeau). Branchement push quand #666 arrive (événement `incident:created` prêt).
- E-mail Resend « Ce qui s'est passé sur <compte> » : faits + lien, respecte `notificationsEmail`
  et `serviceEmailsOptOutAt`, envoyé une fois (`emailedAt`). Texte final montré à Greg avant activation.

### Démo
Incident d'exemple sur « Apex 50k · Éval #1 » : `BehaviorAlert` + `PropRiskEvent` sur sa dernière
journée, constats et `aiAnalysis` **écrits en dur** dans le seed (aucun appel IA). Module pur (tsx).

### Agents à mettre à jour
`prisma.md` (modèle), `nestjs.md` (module, déclencheurs), `angular.md` (page), `plans.md` (gating),
`tests.md` si besoin.

## 3. Étapes (un commit chacune)
1. `feat(api)`: modèle `AccountIncident` + migration.
2. `feat(api)`: chronologie et constats purs + tests.
3. `feat(api)`: détection (3 déclencheurs) + tests d'intégration (un seul incident).
4. `feat(api)`: routes + analyse IA Premium persistée.
5. `feat(api)`: e-mail Resend (désactivé par défaut tant que le texte n'est pas validé).
6. `feat(app)`: page autopsie + entrées (390 puis 1440) + captures.
7. `feat(api)`: incident d'exemple dans le seed démo.
8. `docs(agents)`: agents + note de version.

## 4. Choix ouverts — proposition

| # | Question | Proposition |
|---|---|---|
| 1 | Gating | Chronologie + 3 constats en **Free** ; analyse IA en **Premium** (teaser en Free). |
| 2 | « Un incident par compte et par limite » | Drawdown : **1 par compte** (le compte est mort). Perte du jour : **1 par compte et par journée** (la firm met en pause, le compte continue). |
| 3 | Perte du jour en Free | Pas d'incident `daily_loss` en Free (la métrique n'y est pas calculée) : seul le drawdown. |
| 4 | Moment de génération IA | À la première ouverture (Premium), pas à la détection. |
| 5 | Alerte « ignorée » | Trade daté (première sortie) après l'alerte, même journée. Libellé « trade après l'alerte », pas « ignorée » (on ne sait pas si l'user l'a vue). |
| 6 | Notification | Badge dans l'app maintenant ; push branché à la livraison de #666. |
| 7 | E-mail | ~~Activé par défaut~~ → **décision Greg** : jamais par défaut ; part seulement si l'utilisateur a déjà activé `notificationsEmail`, formule « d'après tes trades enregistrés, la limite semble franchie », jamais pour le compte démo, texte montré à Greg avant tout envoi. |
| 8 | Fenêtre de la chronologie | La journée CME du franchissement. **Décision Greg** : les constats peuvent s'appuyer sur les séances précédentes (rythme, taille, pire séance du compte). |
| 9 | Maquette | **Décision Greg** : pas de maquette à faire, `maquettes/mockup-autopsie.html` fait foi (lire avant de coder le front, signaler tout écart impossible avec les composants existants). |

## 5. Ajouts de Greg (2026-10-22)

- **« Ce n'est pas un échec »** : retire l'incident (`dismissedAt`, jamais recréé grâce à l'unicité)
  et remet le compte en actif **seulement** s'il a été passé en échoué en confirmant l'incident
  (`failedByIncidentAt`), jamais après un échec marqué à la main avant. Testé (unitaire + intégration).
- **« Repartir sur une nouvelle tentative »** : réutilise `POST /accounts/:id/retry`, rien de nouveau côté API.
- **Note** « L'heure d'entrée n'est pas enregistrée : la distance est une estimation calculée sur
  les trades clôturés » (maquette) : l'API renvoie `estimatedDistance: true`.
- **Garde-fous** : aucun incident pour le compte démo hors du seed ; aucune IA hors prod
  (`AI_ENABLED`) ; `max_tokens` 400 ; une seule analyse par incident, jamais régénérée.

## 6. Phase 1 livrée (API)

- Modèle `AccountIncident` (`@@unique([accountId, kind, period])`, `period` = `account` pour un
  plancher ou un échec manuel, `AAAA-MM-JJ` pour une perte du jour) + migration additive.
- Chronologie et constats calculés à l'affichage (`incidents/incident-report.ts`), rien de stocké
  sinon l'analyse IA. Les constats ne sont donc pas figés à la création (écart au § 2 : un trade
  synchronisé après une casse en direct entre ainsi dans l'autopsie).
- Routes : `GET /accounts/:id/incidents`, `GET /accounts/:id/incidents/:incidentId` (aucun appel
  IA), `GET …/analysis` (génère une fois, Premium), `POST …/dismiss`.
- Déclencheurs : alerte `breached` en direct, fin d'import / synchro (`importTrades`), saisie
  d'un trade, `PATCH /accounts/:id` vers ÉCHOUÉ (confirmation, ou incident `manual`).
- E-mail : **pas dans la phase 1** (texte à valider par Greg avant tout envoi).

## 7. Phase 2 livrée (application, PR #709)

Page `/accounts/:accountId/autopsie/:incidentId` (paresseuse), entrées depuis Mes comptes et le toast
de la feuille de choix, `openIncidentId` dans `GET /accounts`. **Règle validée par Greg** : « Archiver »
depuis la feuille de choix confirme l'incident comme « Garder comme échoué » (idempotent). Écarts
validés : nouvelle tentative sur un compte Échoué seulement, page bornée à 1180 px, espace insécable
devant `: ; ! ?`, « Voir l'autopsie » sur sa ligne en mobile.

## 8. Phase 3 (démo et documentation)

- Démo : séance de casse sur « Apex 50k · Éval #1 » (5 trades, alerte, paliers de marge), incident
  confirmé, analyse **préenregistrée** signalée « Exemple » (aucun appel IA). Vitrine démo seulement.
- Verrou d'analyse libéré quand l'appel IA échoue ou revient vide (nouvel essai possible).
- Agents mis à jour (nestjs, prisma, angular, plans, tests), note de version
  `docs/notes-de-version/2026-10-autopsie.md`.
- Proposés à Greg, non modifiés : paragraphe de la politique de confidentialité (Anthropic), question
  de FAQ « Qu'est-ce que l'autopsie ? » (à publier quand la feature sera en prod).
