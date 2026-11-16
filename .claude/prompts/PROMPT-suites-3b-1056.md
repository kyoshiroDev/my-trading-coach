corrige le ticket #1056

---

## Complément : texte du ticket #1056 (cahier des charges)

Suites de la PR #1051 (lot 3b), remontées par le test à blanc du circuit vérificateurs → relecteur (#1053). Aucune décision business.

1. **Contrat partagé** : `InsightsResponse` et `InsightsCooldownResponse { cooldownSeconds; insights: InsightsResponse | null }` dans `libs/shared/src/contracts` (nouveau `ai.ts`), utilisés par `ai.service.ts` (`/ai/cooldown`, `POST /ai/insights`) et par `ai.api.ts` (plus de générique recopié). Règle 12 de nestjs.
2. **Débrief (C8 + C13)** : le 400 teste les trades **clôturés** (`closedTrades.length === 0`) ; `getEligibleUsers` filtre `pnl: { not: null }` ; message « Aucun trade clôturé cette semaine pour l'instant. Le débrief se génère dès ton premier trade clôturé de la semaine. » ; test : semaine avec seulement des positions ouvertes → 400, aucun appel IA, hors éligibles. Évite un appel IA payé pour un débrief vide.
3. **Horloge figée** : `freezeClock(...)` dans `debrief.service.spec.ts` et `session/session-history.spec.ts` (règle 1 de tests).
4. **Suppression du compte** : `deleteAccount` efface `ai:insights:last:<userId>` et `ai:cooldown:insights:<userId>` (try/catch + warn si Redis absent), test dans `users-delete.spec.ts`.

Vérificateurs à repasser : nestjs, angular, tests (1) ; instruments, tests (2) ; security (4).

