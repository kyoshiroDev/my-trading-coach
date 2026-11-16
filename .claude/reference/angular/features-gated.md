# Features gated côté front

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Features gated — règles obligatoires · 2026-07-08 -->
> **Origine** : `angular.md` · « Features gated — règles obligatoires » · 2026-07-08

## Features gated — règles obligatoires

⚠️ 2 paliers depuis PROMPT-169 : cf. `.claude/agents/plans.md` (source de vérité).
`isPremium()` = PREMIUM / trial / admin / beta. L'alias `isStarterOrAbove` a été
**supprimé**. L'IA **mutualisée** (contexte marché, news, calendrier éco IA) est **FREE**
(aucun gate front) ; la profondeur d'analyse + l'IA personnelle (analytics avancés, Weekly
Debrief, IA Insights, chat coach, score, recap 17h30) sont **PREMIUM** (`isPremium`).

**Premium offert par l'admin** (`UserStore.isOfferedPremium()`) : `trialEndsAt` futur **sans**
abonnement Stripe `active`/`trialing` (`AuthUser.stripeSubscriptionStatus`). Aucun prélèvement
prévu et pas de client Stripe → **jamais** de bouton portail ni de texte « premier prélèvement »
(Profil > Abonnement affiche « 🎁 Premium offert » + « Continuer en Premium → » qui ouvre la
modale de plans). `UserStore.trialAvailable()` (= `!trialUsed`) : la modale de plans ne promet
l'essai Stripe (« 30 jours d'essai », `TRIAL_LABEL`) que s'il est encore disponible, sinon le checkout facture tout de suite.
**Même libellé sur TOUS les paywalls** (statistiques, score, insights, débrief, bannière du dashboard,
Profil, cadenas), un seul calcul `PaywallCtaService.label` (E3 #1013, décision du 2026-11-15), dans cet ordre :
offre fondateur ouverte → « Passer à Premium · 29 €/mois à vie (offre fondateur) → » (prix de `PRICING.founder`) ;
sinon `trialAvailable()` → « Essayer Premium · 30 jours d'essai → », mention « 30 jours d'essai · carte requise » ;
sinon « Passer à Premium → », mention « Sans engagement · annulable en un clic ». Jamais « 1 mois offert »
(réservé au mois offert du parrain). Garde-fou : `plan-modal/trial-cta-copy.spec.ts` échoue sur une mention en dur.

**Pattern dans les composants qui gate une feature PREMIUM :**

```typescript
private readonly userStore = inject(UserStore);
// on utilise directement userStore.isPremium() dans le template
```

```html
@if (userStore.isPremium()) {
  <!-- feature accessible -->
} @else {
  <mtc-premium-lock title="Titre de la feature" subtitle="Disponible en Premium" />
}
```

Si l'API retourne `{ code: 'PREMIUM_REQUIRED' }` → afficher le lock (ou rediriger vers
`/settings`). Cohérence obligatoire aux 4 points de `plans.md`.
