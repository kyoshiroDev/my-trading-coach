# Détecteurs de comportement (#602)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Détecteurs de comportement (#602, phase 1 : moteur + mode silencieux, 2026-10-18) · 2026-10-18 -->
> **Origine** : `nestjs.md` · « Détecteurs de comportement (#602, phase 1 : moteur + mode silencieux, 2026-10-18) » · 2026-10-18

## Détecteurs de comportement (#602, phase 1 : moteur + mode silencieux, 2026-10-18)

Module `modules/behavior/`. **Rien n'est affiché** tant que Greg n'a pas validé les chiffres du rejeu
(`docs/rapport-detecteurs-silencieux.md`). Méthode et limites : `docs/audit-detecteurs-comportement.md`.

- **Principe** : ne jamais prendre un style pour du tilt. B, C1 et C3 comparent le trader **à
  lui-même** (référence personnelle), B exige **au moins 2 signaux**. A (règles du plan) et C2
  (limite déclarée `tradesPerDayMax`) ont des seuils fixes parce que la règle vient d'ailleurs.
- **Tous les seuils** dans `behavior.constants.ts`, documentés. Pas de seuil ailleurs.
- **Lignes → positions** (`behavior-positions.ts`) : un `Trade` importé est une PAIRE de fills ; une
  ligne prolonge la position précédente (même compte / actif / sens) si elle sort dans les 2 s ou
  partage un prix d'entrée. Séance du moteur = **compte × journée CME** (`tradingDay`), pas
  `TradeSession` (rarement rattachée aux trades synchronisés).
- **Référence** (`behavior-baseline.ts`, pur) : 20 dernières séances CLÔTURÉES, persistée dans
  `BehaviorBaseline` par `BehaviorBaselineService` : cron `10 17 * * 1-5` Chicago (après
  `SessionCloseCron`, traders des dernières 26 h, hors démo) + recalcul à la volée si datée d'une
  journée précédente. Apprentissage : < 10 séances → B, C1, C3 muets.
- **Détecteurs** (`behavior-detectors.ts`, purs, aucun appel IA) : A1 taille > max du plan (micros
  ramenés en minis si mélange), A2 points défavorables avant la perte max du jour (seuils par actif),
  A3 entrée avec > 50 % de la perte max consommée, B vengeance, C1 3 pertes d'affilée, C2 au-delà de
  `tradesPerDayMax`, C3 taille ≥ 2× la perte précédente du même actif. Anti-spam : même type ≤ 1 fois
  / 15 min / séance. **Messages factuels** : décrire, jamais conseiller (AMF), pas de tiret cadratin.
- **Règles du plan** (`behavior-plan.ts`) : phase selon le type de compte, palier de max de contrats
  selon le profit, perte max via `dailyLossLimitAmount`. Sans plan relié au catalogue, A est muet.
- **En direct** (`BehaviorAlertsService`) : branché dans `tradovate-live.gateway.ts` sur
  `tradovate:balance` (émis après chaque synchro live, donc chaque fill / position), regroupé 1,5 s par
  compte, worker titulaire. Nouvelle entrée = position Redis (`tradovate:positions:<connexion>`)
  absente, retournée ou renforcée par rapport au dernier état vu (`behavior:pos:<compte>`, 12 h) ;
  premier relevé = mémorisé sans alerte. Perte max du jour et solde lus dans `AccountsService.list`
  (rien recalculé). Anti-spam partagé : `behavior:spam:<compte>:<journée>:<type>` (SET NX PX 15 min).
  Alerte **enregistrée** (`BehaviorAlert`) ; événement `behavior:alert` seulement si
  `BEHAVIOR_ALERTS_UI=true`. `BEHAVIOR_ALERTS_RECORD=false` coupe tout. Aucun appel Tradovate en
  plus, aucune synchro relancée. Hors démo. Rien ne tourne app fermée.
- ⚠️ **Heure d'entrée absente en base** (`tradedAt` = clôture) : au rejeu, l'entrée est datée de la
  première sortie (comme la référence) ; en direct, de l'ouverture Tradovate, comparée à une
  référence mesurée de sortie à sortie → biais vers plus d'alertes B en direct. Correctif proposé :
  `Trade.openedAt` (non fait).
- ⚠️ **Recoupement avec l'anti-tilt #371** (`tilt-detection.ts`, affiché, seuils fixes ligne par
  ligne) : laissé tel quel en phase 1. Si les détecteurs sont validés, l'UI de phase 2 le remplace.
- **Rejeu** : `apps/api-mytradingcoach/scripts/replay-behavior-alerts.ts` (lecture de fichiers
  exportés en lecture seule et pseudonymisés, requêtes en annexe du rapport ; jamais de connexion à
  la base). `behavior-replay.ts` (pur) : référence de chaque séance sur les journées précédentes
  seulement, verrouillé par `behavior-replay.spec.ts`.

<!-- Origine : prisma.md · Détecteurs de comportement (#602, phase 1, 2026-10-18) · 2026-10-18 -->
> **Origine** : `prisma.md` · « Détecteurs de comportement (#602, phase 1, 2026-10-18) » · 2026-10-18

## Détecteurs de comportement (#602, phase 1, 2026-10-18)

- `BehaviorBaseline` (migration `20261018120000_behavior_baseline`, table nouvelle, additive) : une
  ligne par utilisateur (`userId` = PK, cascade), `sessionsUsed`, `throughDay` (`DATE`), `data` Json
  = `BehaviorBaselineData` (`modules/behavior/behavior-baseline.ts` : délais entre positions, taille
  médiane / p75 / p90 par actif, positions par séance). Table dédiée plutôt qu'un Json sur `User` :
  `User` est lu à chaque requête authentifiée et la référence a son propre cycle (recalcul à la
  bascule CME, à la volée si datée d'une journée précédente). Rien à ajouter au seed démo : la démo
  n'enregistre pas d'alertes (lecture seule, pas de synchro live).
- `BehaviorAlert` (migration `20261018130000_behavior_alert`, table nouvelle, additive) : alerte de
  comportement enregistrée en direct, **en silence** en phase 1. `userId` (cascade), `accountId`
  (cascade), `tradeDay` (`DATE`, journée CME = séance du moteur avec le compte), `sessionId`
  (`TradeSession`, SetNull, souvent vide : les trades synchronisés sont rarement rattachés à une
  session), `tradeId` (SetNull, vide en direct : le trade n'existe qu'à la sortie), `type` /
  `severity` en TEXT (liste dans `behavior-detectors.ts`), `message`, `context` Json, `dismissedAt`,
  `mutedByUser` (prévus pour l'UI de phase 2). Index `(userId, createdAt)`, `(accountId, tradeDay)`.
  Volume attendu ≈ 1 alerte par séance de trader actif : conservation à décider avant la phase 2
  (`RETENTION_RULES`).
