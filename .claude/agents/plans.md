# Agent Plans — Tarification, paliers & gating

## Rôle
**Source de vérité unique** pour les plans, prix, quotas, la matrice feature×plan et le gating.
Toute feature gated DOIT être cohérente aux **4 endroits** (voir Règle d'or). En cas de doute sur « qui a accès à quoi, à quel prix, gated comment » → c'est ici, pas éparpillé dans les autres agents.

---

## Sources de vérité (code)
- **Prix affichés** : `apps/app-mytradingcoach/src/app/core/constants/pricing.const.ts` (`PRICING`, `FREE_TRADE_LIMIT`, `ACCOUNT_LIMITS`) **+** landing `apps/landing-mytradingcoach/src/components/Pricing.astro`. Les deux DOIVENT afficher les mêmes montants.
- **Facturation** : price IDs Stripe en env — `STRIPE_STARTER_PRICE_MONTHLY` / `_YEARLY`, `STRIPE_PREMIUM_PRICE_MONTHLY_V2` / `_YEARLY_V2`. ⚠️ Les **montants réels vivent dans Stripe** (pas en dur backend) → vérifier que `_V2` = 79€/699€.
- **Quotas comptes** : `apps/api-mytradingcoach/src/modules/accounts/accounts.service.ts` (`FREE_ACCOUNT_LIMIT` 1 · `STARTER_ACCOUNT_LIMIT` 3 · Premium `null`).
- **Limite trades FREE** : `apps/api-mytradingcoach/src/modules/trades/trades.service.ts` (30/mois, code `FREE_LIMIT_REACHED`).

---

## Les 3 paliers

| | Prix | Trades/mois | Comptes | Essai |
|---|---|---|---|---|
| **FREE** | 0€ | 30 | 1 | – |
| **STARTER** | 39€/mois · 349€/an (−119€) | illimité | 3 | 7 j |
| **PREMIUM** | 79€/mois · 699€/an (−249€) | illimité | illimité | 7 j |

---

## Principe de gating — RÈGLE FONDAMENTALE
> **On ne verrouille JAMAIS la vue de ses propres données. On verrouille la PROFONDEUR d'analyse.**

- **FREE = le *quoi*** : voir ses chiffres et ses vues de base (courbe d'équité simple, P&L/jour, répartition setups/actifs en %, émotions, KPIs). Voir ce qu'on a fait est gratuit — c'est la récompense de logger, donc le moteur d'activation.
- **STARTER = le *comment*** : la profondeur d'analyse par-dessus les mêmes données (win rate par setup/actif, heatmaps jour/heure, drawdown détaillé, filtres et comparaisons croisées, multi-comptes, export).
- **PREMIUM = le *pourquoi / quoi faire*** : la couche IA (insights sur les patterns, recommandations, coach). Pas des graphes verrouillés, de l'analyse IA.

**Corollaire design** : on ne verrouille pas une **carte**, on verrouille la **couche de profondeur** dedans (vue de base visible en Free · bouton/onglet « analyse avancée » en Starter · IA en Premium). Un teaser flouté + cadenas est réservé aux couches réellement payantes, jamais aux données de base de l'utilisateur.

---

## Matrice feature × plan (grille de référence)

**Socle (FREE et +)** : compagnon de session (pré-session + live + débrief de base), journal (émotions, setups), import + historique illimité (l'historique ne compte pas dans la limite FREE), `/analytics/summary` (win rate, P&L, streak).

**STARTER (et +)** : trades illimités · 3 comptes · analytics avancés (heatmap, equity curve) · Score trader /100 · Export PDF mensuel · **IA bornée/mutualisée** :
- 📋 **Weekly Debrief IA** (auto, 1/user/semaine)
- 📊 **Contexte marché** (DXY, taux US, indices)
- 📅 **Calendrier éco IA** (bull/bear par actifs)
- 📰 **Flux news filtrées** sur tes actifs

**PREMIUM** : comptes illimités · règles prop firm par compte · **IA qui scale avec l'usage** :
- 💬 **Chat coach IA** (interactif)¹
- ✨ **IA Insights à la demande** (analyse de tes patterns)
- 🧠 **Synthèse IA news « pour tes actifs »** (à construire, mutualisée par signature d'actifs)
- 🌙 **Recap journalier email 17h30**

¹ **Chat coach** : usage réel mesuré ≈ **0 %** (admin, 30 j). NE PAS en faire l'ancre Premium ni investir dessus sans demande confirmée. Statut : sous revue (retirer / recadrer en contextuel-rétrospectif AMF). L'ancre Premium réelle = Insights + Debrief riche + comptes illimités.

---

## Gating du dashboard — carte par carte
Application de la règle fondamentale à l'écran principal. Vue de base = FREE ; profondeur = STARTER ; IA = PREMIUM.

| Carte | FREE (visible) | STARTER (profondeur) | PREMIUM |
|---|---|---|---|
| KPIs (Capital, P&L, Win rate, Profit factor, Trades, Drawdown) | ✅ tout | – | – |
| Courbe d'équité | ✅ courbe simple | drawdown détaillé, périodes comparées, annotations | – |
| P&L par jour | ✅ | – | – |
| Top actifs (P&L/instrument) | ✅ vue simple | win rate/actif, filtres croisés actif×session×setup | – |
| Répartition stratégies (par setup) | ✅ camembert % | **win rate & rentabilité par setup** | – |
| États émotionnels | ✅ (tracking émotionnel = socle Free) | – | – |
| AI Coach / Insights | – | – | ✅ teaser flouté + cadenas |

Règles :
- **Une seule carte verrouillée** sur le dashboard : l'IA Coach. Le reste montre les données de l'utilisateur.
- Ne JAMAIS afficher une pastille `● LIVE` sur une carte verrouillée (contradiction). Le lock l'emporte.
- Le badge d'un item (sidebar/carte) doit refléter le plan RÉEL de la feature ET ce que le backend livre (cf. Règle d'or).

---

## Modèle de coût IA (règle de tiérage)
On tiér par **structure de coût**, PAS par « IA vs pas d'IA ».

- **MUTUALISÉ** — coût O(signatures d'actifs / clés partagées), indépendant du nb de users → **peut aller en Starter** :
  - Contexte marché : 1 clé Redis partagée `market:context` (TTL).
  - Calendrier éco : cache BDD `ecoAnalysisCache` par `(date, assetsKey)`, `userId:'shared'` → 1 appel IA par (jour, jeu d'actifs).
  - News : `marketNews` partagé (cron 20 min) ; sentiment = fourni par FMP (pas IA) ; traduction Haiku **1×/article**, `userId:null`, cachée en BDD.
- **BORNÉ** — 1/user/période, `max_tokens` capé → **Starter OK** :
  - Weekly Debrief : 1/user/semaine.
- **SCALE AVEC L'USAGE** — O(users × engagement) → **PREMIUM uniquement** :
  - Chat coach (multi-tours), IA Insights à la demande, recap quotidien.

**Coût IA réel constaté** (admin, 30 j) : ≈ **4,60 USD total** (eco_translation 45 %, debrief 35 %, news_translation 20 %, recap ~0, chat 0). → Le coût IA n'est PAS un sujet ; ne pas sur-optimiser un poste à ~4€. Autoritatif = Anthropic Cost Report API.

---

## Règle d'or — cohérence aux 4 points
Toute feature gated doit être alignée **partout**, sinon on vend une chose qu'on ne livre pas :
1. **Landing** (`Pricing.astro`) — ce qui est promis.
2. **Front app** — affichage + accès (`isStarterOrAbove` / `isPremium`, badges, `premium-lock`).
3. **Guard backend** (`StarterGuard` / `PremiumGuard`) sur le controller.
4. **Éligibilité asynchrone** (crons) — `debrief.getEligibleUsers()`, `daily-recap` (where plan).

> L'incohérence historique à ne jamais reproduire : « Weekly Debrief vendu Starter (landing+front+StarterGuard) mais cron `getEligibleUsers` = PREMIUM/ADMIN » → Starter payait une IA jamais livrée.

---

## Gating — qui gouverne quoi
- **StarterGuard** passe : ADMIN, BETA_TESTER, essai actif, STARTER, PREMIUM.
- **PremiumGuard** passe : ADMIN, BETA_TESTER, essai actif, PREMIUM.
- **Weekly Debrief** : controller `StarterGuard` **ET** cron `getEligibleUsers()` doivent matcher → `plan ∈ {STARTER, PREMIUM}` ou `role ∈ {ADMIN, BETA_TESTER}`.
- **Daily recap** : PREMIUM only (cron `where plan PREMIUM`). Nettoyer le test mort `STARTER||PREMIUM` dans `daily-recap.service`.
- **IA éco (bull/bear), contexte marché, news** : accès **Starter+** (grille cible).
- **Front** : `isStarterOrAbove` = STARTER+ · `isPremium` = PREMIUM.

## Essai 7 jours
Appliqué à **tout** checkout si `!user.trialUsed` (Starter ET Premium). Ne jamais restreindre au Premium.

---

## Checklist avant TOUT changement de plan/feature
- [ ] Prix identiques `pricing.const.ts` == `Pricing.astro`.
- [ ] Feature gated cohérente aux **4 points** (landing / front / guard / cron).
- [ ] Nouvelle feature IA classée **mutualisé / borné / scale** → tiérée en conséquence.
- [ ] Jamais une IA « scale » en Starter/Free sans borne dure.
- [ ] Quota modifié → `accounts.service` **et** `ACCOUNT_LIMITS` (front) alignés.
- [ ] Copie AMF-compliant (aucune promesse de gain).

---

## ✅ Deltas alignés sur la grille cible (résolus)
Les écarts historiques ont été corrigés — état du code == grille cible :
1. **Weekly Debrief** ✅ : `debrief.getEligibleUsers()` inclut désormais `STARTER, PREMIUM, ADMIN, BETA_TESTER` (matche le StarterGuard + landing/front).
2. **Contexte marché · calendrier éco IA · news** ✅ : accès **Starter+** — éco IA `StarterGuard` (`eco-calendar.controller`), `market-context` + `news` `StarterGuard` (`trades.controller`), landing sous STARTER, front gaté `isStarterOrAbove` (polling `session.store`, websocket/analyse éco `session-live`).
3. **CLAUDE.md** ✅ : plans dé-dupliqués → pointeur vers ce fichier (plus de « Starter n'a pas d'IA »).
4. **daily-recap.service** ✅ : recap = **PREMIUM only** (test mort `STARTER || PREMIUM` retiré).
5. **Dashboard vues de base = FREE** ✅ : `equity-curve` (+ `current-month`, `daily`), `by-emotion`, `top-assets` dégatés (FREE) ; carte Equity déverrouillée pour FREE. Restent Starter : `by-hour`, `by-setup`, `activity/:year/:month` (profondeur).

### ⏳ Reste à construire (gap de feature, pas un mis-gating)
- **Répartition setups « camembert % » FREE** : la seule carte setup du dashboard est « Win Rate / stratégie » (win rate par setup = **profondeur Starter**). La vue de base FREE (part de chaque setup en %) n'existe pas encore — à ajouter pour respecter la ligne « Répartition stratégies : FREE camembert % » de la table dashboard.