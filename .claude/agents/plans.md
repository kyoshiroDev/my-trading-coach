---
name: plans
description: "À appeler pour vérifier un diff qui touche prix, plans, essai, gating, quotas, offre fondateur, codes partenaires ou e-mails liés aux plans, quel que soit le dossier. À lire aussi avant de coder sur ces sujets (source de vérité)."
tools: Read, Grep, Glob, Bash
---

# Agent Plans — Tarification, paliers & gating

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement les parties du diff qui touchent prix, plans, essai, accès ou quotas, quel que soit le dossier (`git diff origin/dev...HEAD`, puis les fichiers concernés), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Cohérence aux 4 points : landing (+ JSON-LD, CGU), front (`isPremium`, badges, `premium-lock`), guard (`PremiumGuard`), crons d'éligibilité.
2. Valeurs (prix, durées, places, quotas, `PLAN_BENEFITS`) depuis `@mtc/shared` / `PRICING`, jamais en dur.
3. 2 paliers seulement : FREE et PREMIUM (aucun STARTER).
4. Gating : FREE = le quoi (+ IA mutualisée), PREMIUM = le comment et le pourquoi ; on verrouille la couche de profondeur, pas la carte.
5. Trades FREE illimités ; quota de comptes FREE 1.
6. Essai : 14 jours offerts à l'inscription sans carte ; essai Stripe 30 j seulement mensuel, comptes antérieurs jamais essayés ; jamais « 1 mois offert » hors parrain et lot du tirage mensuel des gratuits (`reference/commun/tirage-mensuel.md`).
7. Offre fondateur : 29 € / 290 € à vie, 200 places, pas d'essai Stripe.
8. Libellés de paywall uniques (`PaywallCtaService`, décision E3).
9. Comptes démo, ADMIN et BETA_TESTER traités comme prévu dans les e-mails et agrégats de plan.
10. Toute décision business nouvelle (prix, offre, essai, gratuit/Premium) remontée à Greg, jamais tranchée dans le diff.
11. Checklist « avant TOUT changement de plan/feature » suivie.

Réponse, toujours ce format, court :
```
Domaine : plans
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

## Rôle
**Source de vérité unique** pour les plans, prix, quotas, la matrice feature×plan et le gating.
Toute feature gated DOIT être cohérente aux **4 endroits** (voir Règle d'or). En cas de doute sur « qui a accès à quoi, à quel prix, gated comment » → c'est ici, pas éparpillé dans les autres agents.

> **Bascule PROMPT-169** : le palier **STARTER a été supprimé**. Il ne reste que **FREE** et **PREMIUM**.
> Ce qui était « Starter » se répartit désormais : l'**IA mutualisée** (contexte marché, calendrier éco, news) descend en **FREE** ; la **profondeur d'analyse** (analytics avancés, Weekly Debrief, Score trader, multi-comptes) monte en **PREMIUM**. Aucun abonné payant au moment de la bascule → pas de grandfathering.

---

## Sources de vérité (code)
- **Prix affichés** : `apps/app-mytradingcoach/src/app/core/constants/pricing.const.ts` (`PRICING`, `ACCOUNT_LIMITS`) **+** landing `apps/landing-mytradingcoach/src/components/Pricing.astro`. Les VALEURS viennent de `libs/shared/src/pricing.ts` (`@mtc/shared`) ; les `pricing.const.ts` de l'API (`PRICING_EUR`, `TRIAL_PERIOD_DAYS`, MRR) et de l'admin en dérivent. La lib + la landing + le JSON-LD (`Base.astro`) + les CGU DOIVENT afficher les mêmes montants.
- **Facturation** : price IDs Stripe en env — `STRIPE_PREMIUM_PRICE_MONTHLY_V2` / `_YEARLY_V2` (les vars `STRIPE_STARTER_*` ont été supprimées). ⚠️ Les **montants réels vivent dans Stripe** (pas en dur backend) → vérifier que `_V2` = **49€ / 490€**.
- **Quotas comptes** : `apps/api-mytradingcoach/src/modules/accounts/accounts.service.ts` (`FREE_ACCOUNT_LIMIT` 1 · Premium `null` = illimité). Miroir front `ACCOUNT_LIMITS` (`free: 1`, `premium: null`).
  Seuls les comptes **ACTIVE** consomment le quota : Validé, Échoué et Archivé libèrent la place.
  **Compte perdu (#677, #681)** : fonctionnalité **non gatée** (tous plans). La nouvelle tentative
  (`POST /accounts/:id/retry`) applique le même quota qu'une création : un FREE qui a marqué son seul
  compte comme échoué peut repartir, puisque l'échoué a libéré la place. Les comptes échoués et
  archivés sortent des statistiques « tous les comptes » quel que soit le plan (`includeInactive`
  pour les réinclure) ; la règle ne change rien au gating des analytics Premium.
  **Autopsie d'un compte grillé (#669)** : chronologie, distance à la limite et 3 constats en
  **Gratuit** (zéro IA) ; **analyse IA en Premium** (une par incident, `max_tokens` 400, persistée,
  jamais régénérée, jamais hors prod ni pour la démo). Perte du jour : métrique Premium, donc incident
  `daily_loss` en Premium seulement ; le plancher vaut pour tous.
- **Trades FREE** : **illimités** — le quota mensuel (`checkMonthlyLimit` / `FREE_LIMIT_REACHED`) a été **supprimé**.
- **Essai** : `TRIAL_PERIOD_DAYS = 30` (api pricing.const). Accordé **uniquement** sur le prix **mensuel** ET si `!user.trialUsed`. L'annuel est facturé immédiatement, sans essai.
- **Essai d'inscription (#769)** : `PREMIUM_SIGNUP_TRIAL_DAYS = 14` (`@mtc/shared`), sans carte, posé à la création du compte, puis retour automatique au gratuit. Il pose `trialUsed = true` : **pas de second essai** de 30 j au checkout (prélèvement immédiat du mensuel). Voir « Essai d'inscription » plus bas.

---

## Les 2 paliers

| | Prix | Trades | Comptes | Essai |
|---|---|---|---|---|
| **FREE** | 0€ · sans CB | illimité | 1 | – |
| **PREMIUM** | 49€/mois · 490€/an (−98€) | illimité | illimité | 14 j offerts à l'inscription, sans carte (#769) ; 30 j Stripe seulement pour les comptes antérieurs jamais essayés |

---

## Principe de gating — RÈGLE FONDAMENTALE
> **On ne verrouille JAMAIS la vue de ses propres données. On verrouille la PROFONDEUR d'analyse.**

- **FREE = le *quoi* (+ IA mutualisée)** : voir ses chiffres et ses vues de base (courbe d'équité simple, P&L/jour, répartition setups/actifs en %, émotions, KPIs), le compagnon de session complet, ET l'IA **mutualisée** (contexte marché, calendrier éco IA, news filtrées) dont le coût est indépendant du nombre d'users. Voir ce qu'on a fait est gratuit — c'est le moteur d'activation.
- **PREMIUM = le *comment* et le *pourquoi*** : la profondeur d'analyse par-dessus les mêmes données (win rate par setup/actif, heatmaps jour/heure, drawdown détaillé, filtres croisés, multi-comptes) **ET** la couche IA **personnelle** (Weekly Debrief, IA Insights sur les patterns, Chat coach).

**Corollaire design** : on ne verrouille pas une **carte**, on verrouille la **couche de profondeur** dedans (vue de base visible en Free · analyse avancée / IA personnelle en Premium). Un teaser flouté + cadenas est réservé aux couches réellement payantes, jamais aux données de base ni à l'IA mutualisée (désormais FREE).

---

## Gating du dashboard — carte par carte
Vue de base = FREE ; profondeur & IA = PREMIUM.

| Carte | FREE (visible) | PREMIUM |
|---|---|---|
| KPIs (Capital, P&L, Win rate, Trades, Drawdown) | ✅ tout | – |
| Courbe d'équité | ✅ courbe simple | drawdown détaillé, périodes comparées |
| P&L par jour | ✅ | – |
| Top actifs (P&L/instrument) | ✅ vue simple | win rate/actif, filtres croisés |
| Répartition stratégies (par setup) | ✅ camembert % | **win rate & rentabilité par setup** |
| États émotionnels | ✅ (socle Free) | – |
| Contexte marché / news / calendrier éco IA | ✅ (IA mutualisée) | – |
| AI Coach / IA Insights / Weekly Debrief / Score | – | ✅ teaser flouté + cadenas |
| Bouclier annonces (#670) | ✅ alerte en séance (toast) | stat « Tes trades autour des annonces » (avec le débrief) ; alerte app fermée = veille serveur, déjà Premium |

Règles :
- Ne JAMAIS afficher `● LIVE` sur une carte verrouillée (le lock l'emporte).
- Le badge d'un item (sidebar/carte) doit refléter le plan RÉEL de la feature ET ce que le backend livre. Badges front = **PREMIUM** (plus de badge STARTER).

---

## Règle d'or — cohérence aux 4 points
Toute feature gated doit être alignée **partout**, sinon on vend une chose qu'on ne livre pas :
1. **Landing** (`Pricing.astro` + JSON-LD `Base.astro` + CGU) — ce qui est promis.
2. **Front app** — affichage + accès (`isPremium`, badges PREMIUM, `premium-lock`).
3. **Guard backend** (`PremiumGuard`) sur le controller (le `StarterGuard` a été supprimé).
4. **Éligibilité asynchrone** (crons) — `debrief.getEligibleUsers(refDate)`, `daily-recap` (where plan).

> L'incohérence historique à ne jamais reproduire : « feature vendue sur la landing mais cron d'éligibilité restreint » → le client paie une IA jamais livrée.

---

## Checklist avant TOUT changement de plan/feature
- [ ] Prix identiques dans **`libs/shared/src/pricing.ts`**, la landing, le JSON-LD et les CGU.
- [ ] Feature gated cohérente aux **4 points** (landing / front / guard / cron).
- [ ] Nouvelle feature IA classée **mutualisé (FREE) / borné (PREMIUM) / scale (PREMIUM)**.
- [ ] Quota comptes modifié → `accounts.service` **et** `ACCOUNT_LIMITS` (front) alignés.
- [ ] Copie AMF-compliant (aucune promesse de gain).
- [ ] Compte démo : nouvelle feature à données → vérifier l'affichage démo + enrichir le seed.

> **Valeurs tarifaires centralisées (2026-09-13)** : 49 € / 490 €, essai 30 j et quotas de comptes
> vivent dans `libs/shared/src/pricing.ts` (`@mtc/shared`). Les `pricing.const.ts` de l'API, de
> l'app et de l'admin en dérivent (mêmes noms d'export qu'avant). Changer un prix = ce fichier +
> la landing `Pricing.astro` + les `STRIPE_*_PRICE_*`.

---

## Détail déplacé (résumé)

- **Essai** : 14 jours de Premium offerts à l'inscription, sans carte, puis gratuit ; essai Stripe 30 j seulement pour les comptes antérieurs jamais essayés (`reference/commun/essai-premium.md`).
- **Offre fondateur** : 29 €/mois ou 290 €/an à vie, 200 places, pas d'essai Stripe ; codes partenaires calculés sur 49 € (`reference/commun/offre-fondateur.md`).
- **Matrice, coût IA, gating détaillé** : `reference/plans/*`.

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `plans/cout-ia.md` | coût IA, tiérage |
| `plans/gating-detail.md` | quel guard / quel front gouverne une feature |
| `plans/matrice-features.md` | qui a accès à quoi (grille complète) |
| `commun/essai-premium.md` | essai d'inscription 14 j, essai Stripe 30 j, fin d'essai, libellés d'essai |
| `commun/offre-fondateur.md` | offre fondateur, places, codes partenaires, route publique `/pricing/founder` |
| `commun/tirage-mensuel.md` | tirage au sort mensuel : éligibilité, lots (Premium offert, avoir Stripe), interrupteurs, e-mails |
