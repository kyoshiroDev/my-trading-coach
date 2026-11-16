# Journal : R/R inconnu et saisie du stop initial (#916)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · R/R inconnu et saisie du stop initial (Journal, #916) · 2026-11-09 -->
> **Origine** : `angular.md` · « R/R inconnu et saisie du stop initial (Journal, #916) » · 2026-11-09

## R/R inconnu et saisie du stop initial (Journal, #916)

- Un R/R `null` ou absent s'affiche **« — »**, jamais « 0 » (un 0 se lit comme un R/R mesuré nul) :
  Journal (info-bulle « Stop loss ou take profit non renseigné. Ajoute ton stop initial pour calculer
  le R/R. »), trades récents, Analytics par setup, conseils du tableau de bord (émotions sans R/R
  écartées), objectif « R:R minimum » de la session (`minRrFailureLabel`). Moyennes : R/R connus
  seulement (`averageKnownRiskReward`). Templates : `!== null && !== undefined` (lint eqeqeq).
- Score trader : sans aucun R/R connu, la barre « Gestion risque » est **non mesurée** (`score: null`,
  « — », infobulle `RISK_UNMEASURED_HINT`) et **exclue du score global** (`globalScoreOf`), au lieu de
  valoir 0 (#930).
- Fenêtre de saisie du stop : plus d'alerte « note Non évaluée » — un stop sans objectif garde la note
  comportementale (#929), l'infobulle de la note le dit (`gradeTooltip`).
- Ligne du Journal sans R/R : bouton cible « Ajouter le stop initial » (`data-testid="trade-add-stop"`,
  colonne actions passée à 88 px, Exécution 1.15fr / Setup 0.95fr pour garder l'en-tête sur une ligne à
  1440 px) → `mtc-trade-stop-dialog` (stop obligatoire, objectif facultatif,
  virgule acceptée). Aperçu en direct du risque (`stopRiskAmount` avec `tickValue`/`tickSize` de
  `GET /instruments`, en points si l'instrument n'a pas de valeur du point) et du R/R
  (`plannedRiskReward`), refus du mauvais côté (`stopPlacementError`) : mêmes fonctions que l'API
  (`@mtc/shared`), qui revérifie. Proposé sur tout trade sans R/R (synchronisé, importé ou manuel).
- Test d'un composant à `templateUrl` + `input()` sous vitest (JIT) : template lu par `readFileSync`
  + `overrideComponent`, et signal posé directement sur l'instance (`trade-stop-dialog.component.spec.ts`).
