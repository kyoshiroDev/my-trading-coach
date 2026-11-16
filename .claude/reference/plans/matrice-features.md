# Matrice feature × plan

> Contenu déplacé à l'identique depuis `.claude/agents/plans.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : plans.md · Matrice feature × plan (grille de référence) · 2026-07-04 -->
> **Origine** : `plans.md` · « Matrice feature × plan (grille de référence) » · 2026-07-04

## Matrice feature × plan (grille de référence)

**Socle FREE** : compagnon de session complet (pré-session + live + débrief), journal (émotions, setups), import + historique illimité, **trades illimités**, `/analytics/summary` (win rate, P&L, streak), vues de base du dashboard (équité simple, P&L/jour, top actifs simple, répartition setups en %, émotions), **1 compte de trading**, et l'**IA mutualisée** :
- 📊 **Contexte marché** (DXY, taux US, indices)
- 📅 **Calendrier éco IA** (bull/bear par actifs)
- 📰 **Flux news filtrées** sur tes actifs (+ traduction Haiku cachée)

**PREMIUM** : tout le FREE, plus la **profondeur** et l'**IA personnelle** :
- 📋 **Weekly Debrief IA** (auto, 1/user/semaine ; au plus 2 si un débrief manuel de milieu de semaine est refait le dimanche, C1 #1048)
- ✨ **IA Insights à la demande** (analyse de tes patterns)
- 💬 **Chat coach IA**¹
- 🏆 **Score trader /100**, calculé sur les 100 derniers trades (E2 #1013 : pas hebdomadaire ;
  aucun export de données n'existe, retiré de cette liste, Q3)
- 📈 **Analytics avancés** (heatmap heure, equity/drawdown détaillé, by-setup)
- 📄 **PDF du débrief de la semaine** (aucun rapport mensuel n'existe)
- 🌙 **Recap journalier email 17h30**
- **Comptes illimités**, chacun avec les règles de sa prop firm (le FREE a déjà son compte avec ses règles)
- 🚨 **Alertes avant la limite** et 🧘 **anti-tilt** en direct (+ sons et notifications) : app ouverte
  ou en notification pendant la séance (Q2, #1013), compte Tradovate connecté (synchro en direct uniquement, rien sur une saisie manuelle, pas d'e-mail ;
  push vers les appareils abonnés, #666 ; app fermée, limites, objectif et payout relevés par la
  synchro de fond, jusqu'à 15 min de décalage ; veille serveur #770, éteinte tant que
  `TRADOVATE_WATCH_MAX` n'est pas posé : en direct aussi app fermée pendant la séance, Premium seulement)

### Avantages affichés : liste officielle (`PLAN_BENEFITS`, `@mtc/shared`, validée le 2026-10-19)

Source UNIQUE des listes courtes : fenêtre des offres (app), cartes de tarifs de `/` et `/prop-firm`,
e-mail de bienvenue Premium. Toute ligne = une fonction livrée ; toute ligne Premium = une fonction
réservée au Premium. Changer une ligne → `libs/shared/src/plan-benefits.ts` seulement.
- **Colonne de présentation de `/register` et `/login`** : `SIGNUP_PITCH_POINTS`
  (`libs/shared/src/signup-pitch.ts`), même règle ; une ligne marquée Premium porte le `benefitId` de
  sa ligne `PLAN_BENEFITS.premium` (vérifié par le spec) : aujourd'hui `anti_tilt` et
  `weekly_debrief`. Compagnon de séance, suivi de la marge et journal : sans étiquette (gratuits).
- **Gratuit** : Synchro Tradovate automatique, en lecture seule · 1 compte avec les règles de sa prop
  firm, suivi en direct pendant la séance (equity, marge avant le plancher, objectif ou payout) ·
  Journal et trades illimités, historique complet · Préparation et débrief de chaque séance ·
  Calendrier éco, news et contexte marché.
- **Premium** : Alertes avant d'atteindre ta limite de perte, app ouverte ou en notification pendant
  ta séance (compte Tradovate connecté) · Anti-tilt en direct, app ouverte ou en notification pendant
  ta séance (compte Tradovate connecté) : reprise de
  position après une perte, taille qui grossit, surtrading · Comptes illimités, chacun avec les
  règles de sa prop firm · Débrief de ta semaine rédigé par le coach IA · Analyses avancées : par
  setup, par heure, drawdown détaillé · Coach IA : insights, chat et récap du jour à 17 h 30.
- **Fondateur** : les 6 lignes Premium + prix bloqué à vie + satisfait ou remboursé (`FOUNDER_REFUND_DAYS`).
- La landing masque « Comptes illimités » tant que `FEATURES.multiAccounts` est éteint ; sur la home,
  l'encart « comptes » des cartes le dit déjà, la liste ne le répète pas.
- Bloc détaillé « Ce que Premium ajoute au Gratuit » (home, `Pricing.astro`) : plus long, mais même
  règle (livré ET réservé au Premium). Jamais « sync crypto » (non livrée), jamais « rapport PDF
  mensuel », jamais le calendrier éco ni l'import CSV d'un broker connu (gratuits) présentés comme Premium.

¹ **Chat coach** : usage réel mesuré ≈ **0 %** (admin, 30 j). NE PAS en faire l'ancre Premium. L'ancre Premium réelle = Insights + Weekly Debrief + analytics avancés + comptes illimités.

> **Modèle émotion (PROMPT-163)** : l'émotion de base d'un trade vient de la **journée/session**
> (`TradeSession.moodStart`) ; `Trade.emotion` est un **override optionnel**. **Émotion effective = override
> du trade sinon humeur de la session sinon `null`**. Toute lecture passe par `effectiveEmotion` +
> `isRiskyEmotion`/`isHealthyEmotion` (`common/utils/effective-emotion.util.ts`). Détails → `prisma.md`.

> **Win rate + break-even (PROMPT-160)** : 3 résultats — win (`pnl > ε`), loss (`pnl < -ε`), **break-even**
> (`|pnl| <= ε`). **Win rate = wins / (wins + losses)** (BE hors dénominateur). Calcul centralisé dans
> `computeTradeStats` (`@mtc/shared`, source unique front + back).

> **Note d'exécution (PROMPT-161)** — **calculée, pas saisie** ; **déterministe, zéro token IA** ;
> **indépendante du P&L**. Grade : ≥80 EXCELLENT · 60-79 BON · 40-59 MOYEN · <40 MAUVAIS ; **< 2 critères
> applicables → `null`**. Helper `computeExecutionGrade` (`common/utils/execution-grade.util.ts`).
>
> **Deux barèmes selon la présence d'un stop (PROMPT-168)** — détection **au niveau du trade**.
> `Trade.executionMethod` (`STOP_BASED` | `BEHAVIORAL` | null) **trace lequel a servi** — les deux ne
> mesurent PAS la même chose, **non comparables**.
> - **Barème A — STOP_BASED** (`stopLoss` présent) : 4 critères intrinsèques — stop respecté (35) · R:R
>   ≥1.5 (25) · émotion effective saine (20) · risque ≤1% (20). **Inchangé.**
> - **Barème B — BEHAVIORAL** (`stopLoss` absent : scalp manuel, imports broker ; ou stop présent mais
>   barème A non mesurable — stop seul, ni objectif ni émotion, #929) : 3 critères **relatifs à
>   l'historique du compte** (médianes) — **perte contenue** (40, sur trade perdant : `L≤1.5×Lméd`→1,
>   `≤3×`→0.5, sinon 0) · **pas de revenge** (35, délai depuis le dernier perdant du **même jour** :
>   `<2 min`→0, `2-10`→0.5, `>10`→1) · **taille constante** (25, anti-martingale strict, si le trade
>   précédent est une perte : `Q≤Qméd`→1, `≤2×`→0.5, sinon 0). Même mécanique de score/renormalisation.
>   Aucun critère n'utilise le **signe du P&L comme mesure de réussite**.
> - **Garde-fous B** : **historique minimum 20 trades clôturés** (sinon `null`) ; **< 2 critères → `null`** ;
>   trades ouverts jamais notés.
> - **Contextuel ⇒ recalcul par lot** : `TradesService.recomputeBehavioralGrades(accountId)` recalcule **en
>   une passe** (pas de N+1) après import / édition / suppression / réaffectation. La note **évolue** avec
>   l'historique (attendu). Constantes ajustables dans `execution-grade.util.ts`. **Calibrage** : tout MAUVAIS
>   ou tout EXCELLENT sur données réelles → ajuster les constantes, **pas** la structure.
