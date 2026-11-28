# PROMPT-959 : historique des débriefs passés

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #959 : Débrief : écran d'historique des débriefs passés

Repéré pendant #943 (11/11). En vérifiant ses débriefs recalculés, Greg a écrit : « je vois pas de semaine a zero dans le debrief ».

## Constat
- La page Débrief n'affiche que le débrief de la semaine en cours, ou à défaut le plus récent (`getCurrent`).
- L'API expose `GET /debrief/history` (52 derniers débriefs) et le front a `debriefApi.getHistory()`, mais **aucun composant ne l'utilise**.
- Les débriefs passés ne sont donc visibles nulle part dans l'app. Le PDF existe par semaine (`/:year/:week/pdf`), mais on n'y accède que depuis le débrief affiché.

## Idée
Un écran (ou un sélecteur de semaine) pour consulter les débriefs passés : en-tête de stats, analyse IA, sections par compte, objectifs.

## Points à trancher
- Gating FREE / PREMIUM (lire `.claude/agents/plans.md`).
- Affichage des débriefs d'ancien format (sans sections par compte) et de ceux dont les trades ont été supprimés depuis : #943 les a laissés tels quels.
- Compte démo : enrichir le seed avec plusieurs semaines.

Non commencé : décision de Greg.

### Commentaires du ticket

Demande de Greg du 22/11 : « regarde dans idées de features si certaine sont pas deja dans l'app et complete ». Comparé au code d'origin/dev (adc36458).

#1052 (même besoin, issu de l'audit fonctionnel F5) est fermé comme doublon de ce ticket. Il ajoute deux points à reprendre ici :
- **PDF compris** : une semaine passée doit aussi pouvoir s'exporter en PDF ;
- **validation de Greg du 15/11** : nouvelle feature, hors audit (voir le texte de #1052).

État technique : `apps/app-mytradingcoach/src/app/core/api/debrief.api.ts` a déjà `getHistory` et `getByWeek` (routes `GET /debrief/history` et `GET /debrief/:year/:week`), mais aucun composant ne les appelle ; l'écran Débrief n'utilise que `getCurrent`, `exportPdf` et `generate`.

## Choix retenus (tri du relecteur du 26/11 : « historique débriefs (Premium teaser, seed plusieurs semaines) »)

- Gating : l'écran Débrief et toutes les routes `/debrief` sont déjà Premium (`PremiumGuard`) ; un FREE voit le paywall existant. Rien ne change pour lui.
- Sélecteur de semaine dans l'en-tête du débrief (visible dès qu'il y a plus d'une semaine), chargement par `GET /debrief/:year/:week` ; l'export PDF suit la semaine affichée.
- `GET /debrief/history` (jusque-là appelée par personne) renvoie des entrées légères (`DebriefHistoryItem`), pas 52 débriefs complets.
- Anciens formats : l'écran gère déjà les débriefs sans sections par compte (`legacyStrengths`, `legacyWeaknesses`).
- Seed démo : il crée déjà un débrief par semaine passée tradée (`demo-seed.ts`), rien à ajouter.
