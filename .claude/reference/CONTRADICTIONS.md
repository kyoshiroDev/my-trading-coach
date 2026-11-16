# Lignes remplacées lors du déplacement des agents (2026-11-16)

> Lu par `.claude/scripts/verifier-references.sh` : une ligne d'agent absente après déplacement doit figurer ici
> à l'identique (bloc « Avant »), avec le texte nouveau et la décision qui la remplace. Sinon elle est « manquante ».

## R1 — `.claude/reference/angular/features-gated.md`

**Raison** : C5 · décisions 2026-11-15 (E3, libellé harmonisé des paywalls) et 2026-11-14 (Q1, « 30 jours d'essai · carte requise », jamais « 1 mois offert ») ; code : `PaywallCtaService`, `TRIAL_LABEL`

Avant :

```text
modale de plans). `UserStore.trialAvailable()` (= `!trialUsed`) : la modale de plans ne promet
« 1 mois offert » que si l'essai est encore disponible, sinon le checkout facture tout de suite.
**Même règle sur TOUS les paywalls** (statistiques, score, insights, débrief, bannière du dashboard,
Profil, cadenas) : « Essayer Premium · 1 mois offert » si `trialAvailable()`, sinon « Passer à
Premium → » (et « Sans engagement · annulable en un clic » au lieu de « 1 mois offert · carte
requise »). Garde-fou : `plan-modal/trial-cta-copy.spec.ts` échoue sur une mention en dur.
```

Après :

```text
modale de plans). `UserStore.trialAvailable()` (= `!trialUsed`) : la modale de plans ne promet
l'essai Stripe (« 30 jours d'essai », `TRIAL_LABEL`) que s'il est encore disponible, sinon le checkout facture tout de suite.
**Même libellé sur TOUS les paywalls** (statistiques, score, insights, débrief, bannière du dashboard,
Profil, cadenas), un seul calcul `PaywallCtaService.label` (E3 #1013, décision du 2026-11-15), dans cet ordre :
offre fondateur ouverte → « Passer à Premium · 29 €/mois à vie (offre fondateur) → » (prix de `PRICING.founder`) ;
sinon `trialAvailable()` → « Essayer Premium · 30 jours d'essai → », mention « 30 jours d'essai · carte requise » ;
sinon « Passer à Premium → », mention « Sans engagement · annulable en un clic ». Jamais « 1 mois offert »
(réservé au mois offert du parrain). Garde-fou : `plan-modal/trial-cta-copy.spec.ts` échoue sur une mention en dur.
```

## R2 — `.claude/reference/commun/autopsie-669.md`

**Raison** : C5 · décision 2026-11-15 (E3)

Avant :

```text
- Gratuit : chronologie et constats ; carte IA verrouillée (« Essayer Premium · 1 mois offert » selon
  `trialAvailable`). Premium, `ai.status = 'pending'` : UN appel à `…/analysis` à l'ouverture.
```

Après :

```text
- Gratuit : chronologie et constats ; carte IA verrouillée (libellé unique des paywalls, `PaywallCtaService` :
  fondateur, sinon « Essayer Premium · 30 jours d'essai → » selon `trialAvailable`, sinon « Passer à Premium → »). Premium, `ai.status = 'pending'` : UN appel à `…/analysis` à l'ouverture.
```

## R3 — `.claude/reference/commun/entonnoir-premium.md`

**Raison** : C6 · décisions 2026-10-25 (essai d'inscription 14 j) et 2026-11-14 (Q1)

Avant :

```text
de l'essai (0 essai en prod au 2026-10-07, décision : garder 30 jours).
```

Après :

```text
de l'essai (0 essai en prod au 2026-10-07, décision : garder 30 jours ; remplacée le 2026-10-25 : 14 jours de
Premium offerts à l'inscription sans carte, essai Stripe 30 j seulement pour les comptes antérieurs jamais essayés, Q1 du 2026-11-14).
```

## R4 — `.claude/reference/commun/offre-fondateur.md`

**Raison** : C7 · décision 2026-11-14 (Q1)

Avant :

```text
- **Aucun essai** (premier paiement immédiat) ; l'essai 30 j du 49 € est inchangé.
```

Après :

```text
- **Aucun essai** (premier paiement immédiat) ; l'essai 30 j du 49 € est inchangé (comptes antérieurs à #769 jamais essayés seulement, Q1 du 2026-11-14).
```

## R5 — `.claude/agents/deploy.md`

**Raison** : C4 · fait technique (pas une décision) : `main.ts` `PORT ?? 3000`, API locale sur 3001 (`environment.ts`, tests.md)

Avant :

```text
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000
```

Après :

```text
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000 (port par défaut ; en dev local : PORT=3001, voir angular « Environments »)
```
