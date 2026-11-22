# #668 · Vue multi-comptes : le compte le plus exposé en premier

Plan court (étape 2 des consignes du ticket). Base : `origin/dev` adc36458, branche `feat/multi-comptes-668`.

## Ce qui existe déjà (rien à refaire)

- `GET /accounts` renvoie pour chaque compte `metrics.drawdown` (`margin`, `pct` 0-1, `breached`),
  `metrics.objective` (`current`, `target`, `pct`) et, en Premium avec un plan relié, `metrics.dailyLoss`
  (`remaining`, `limit`, `pct`, `breached`, `approximate`) : `accounts.service.ts:438-622`, `daily-loss.ts`.
- Solde en direct des comptes Tradovate : socket `tradovate:balance` → `SelectedAccountStore.reloadSoon()` ;
  heure du relevé : `metrics.broker.balanceAt` / `equityAt`.
- Mes comptes : tableau de lignes (8 colonnes), compteur « À surveiller » (drawdown ≤ 25 %), bandeau
  « Relie ce compte à son plan », note « Règles prop firm estimées ».
- Session live : un compte par séance (#880), choisi en Pré-session, verrouillé pendant la séance ;
  jauges prop firm du compte de la séance (`live-prop-firm`).

## Ce qui manque (critères du ticket)

| Critère | État | Travail |
|---|---|---|
| 3 distances en $ et en % | objectif seul en % ; plancher en $ seul ; perte du jour absente de Mes comptes | front |
| Tri par exposition, plus exposé en tête et distinct | aucun tri (`displayedAccounts` filtre) | front |
| Comptes sans plan à part, lien vers la liaison | bandeau par ligne, pas de groupe | front |
| Session live : sélecteur 1 tap + vue agrégée | rien | front |
| Direct Tradovate + heure du relevé | existe (infobulle, dépli) | rendre l'heure visible |
| Disclaimer « estimation MyTradingCoach » | note globale de Mes comptes | reprendre dans la vue live |
| Démo : plusieurs comptes, dont un proche de sa limite | 3 comptes actifs, tous loin du seuil | seed |

## Étapes

1. **Exposition (fonction pure, front)** : `account-exposure.util.ts` dans `features/accounts/`.
   - `exposure(account)` = la plus petite marge restante, en fraction : `min(drawdown.pct, dailyLoss.pct)`
     (`dailyLoss` seulement s'il est renvoyé). Dépassé (`breached`) = 0. Sans plan relié ni règle manuelle :
     pas d'exposition (groupe à part).
   - `sortByExposure(accounts)` : comptes actifs avec exposition, du plus petit au plus grand (égalité :
     ordre actuel, statut puis création) ; puis comptes sans plan ; puis échoués / validés (statut
     non actif) ; archivés inchangés (liste repliée).
   - Tests unitaires de la fonction (cas : dépassé, perte du jour plus serrée que le plancher, sans
     plan, Free sans `dailyLoss`, égalités).
2. **Mes comptes** (`accounts.component.*`) :
   - lignes triées par exposition en vue « Tous les comptes » ;
   - compte le plus exposé (au moins 2 comptes avec exposition) : ligne marquée (bordure gauche et
     étiquette « Le plus exposé »), couleur selon `drawdownTone` (rouge ≤ 25 % ou dépassé, jaune
     ≤ 50 %, vert au-delà), constantes importées, aucune valeur en dur ;
   - colonne « Marge » : libellé `ddLabels.margin` gardé (vocabulaire commun), pourcentage ajouté sous
     le montant ; nouvelle colonne « Perte max du jour » (restant + %, Premium ; compte gratuit : modèle
     du teaser existant « Perte max du jour + alertes », sans flou) ; « Objectif » : « … $ pour
     l'objectif » + % (pourcentage déjà là) ;
   - groupe « Sans plan relié » = comptes sans marge calculable (ni plan relié ni règle manuelle), avec
     le bouton « Relier », après les comptes suivis et avant les échoués / validés ; un compte à règles
     manuelles est trié avec les autres et garde son bandeau « Relie ce compte à son plan… » ;
   - heure du relevé visible sous le solde des comptes synchronisés (« il y a 4 min »), plus seulement
     en infobulle ;
   - « À surveiller » compte aussi la perte max du jour (exposition ≤ `ALERT_WARNING_PCT`).
   - Gating dans un seul `computed` (`multiAccountViewEnabled`) : ouvert à tous (décision du 22/11) ;
     test « gratuit avec 3 comptes actifs ».
   - Règles `tableau-lignes.md` : même `grid-template-columns` en-tête / lignes, repli
     `@container acct-table`, aucun défilement horizontal, testé à 360 / 390 / 1440 px.
3. **Session live** : bandeau compact « Mes comptes » sous la barre live, seulement avec au moins
   2 comptes actifs suivis : une pastille par compte (nom court + plus petite marge en %), triées par
   exposition, la plus exposée en premier et colorée selon le même ton. Un tap ouvre le détail du
   compte (3 distances, heure du relevé, disclaimer) dans une feuille. Le compte de la séance reste
   celui de la séance (#880) : le bandeau est une vue agrégée en lecture, pas un changement de séance.
4. **Démo** (`admin/demo-seed.ts`, `demo-data/config.ts`) : le compte éval Apex proche de sa limite
   (marge plancher ≈ 15-20 %, rouge et « À surveiller »), sans 4e compte ni invariant cassé.
   Enrichir la référence `nestjs/demo-seed.md` (périmée : « 2 comptes »).
5. **Docs** : `reference/angular/comptes-prop-firm.md` (tri, groupes, colonnes),
   `reference/design/session.md` (bandeau multi-comptes), `reference/nestjs/demo-seed.md`.
6. Tests de rendu (vrai gabarit) : tri, ligne mise en avant, groupe sans plan, colonne perte du jour
   Free/Premium, bandeau live (absent avec un seul compte), démo. Captures 390 et 1440.

Aucune route ni migration nouvelle : tout est déjà dans `GET /accounts`.

## Choix ouverts (avec proposition)

1. **Gating** : rien de nouveau. Un compte Free n'a qu'un compte actif (`ACCOUNT_LIMITS.free = 1`), le
   tri et le bandeau n'apparaissent qu'à partir de 2 comptes, donc en pratique en Premium. La perte du
   jour reste Premium (déjà calculée seulement en Premium par l'API).
2. **Exposition** = la plus petite des marges restantes (plancher, perte du jour) en %, pas en $
   (comparable entre un 25k et un 150k). L'objectif n'entre pas dans le tri (il ne fait pas casser un compte).
3. **Seuils** : ceux qui existent (25 % attention, 10 % critique), aucun nouveau.
4. **Session live** : vue agrégée en lecture (bandeau + feuille), pas de changement du compte de la
   séance en cours, qui reste verrouillé (#880).
5. **Comptes sans plan** : groupe à part en bas de la liste active, avant les échoués/validés.
6. **Démo** : abaisser la marge d'un compte existant plutôt qu'ajouter un 4ᵉ compte (le capital total
   et les invariants du jeu de données restent).
7. **Maquette** : pas de maquette HTML à part ; l'écran existe déjà, on valide sur captures 390 / 1440
   (et 360) avant le push.
8. **Textes** : « Le plus exposé », « Sans plan relié », « Perte du jour », « Plancher », « relevé il y
   a … », disclaimer existant « Estimation MyTradingCoach, pas le calcul officiel de ta firm. ». Aucun
   conseil d'achat ou de vente (AMF).

## Réponses (relecteur, 22/11 ; gating : Greg suit le relecteur)

1. Gating : ouvert à tous les plans (Greg, 22/11) ; perte max du jour Premium.
2. Exposition : plus petite marge restante en % (plancher, perte max du jour si renvoyée) ; objectif hors
   tri ; compte gratuit : plancher seul, dit dans l'infobulle.
3. Seuils : `drawdownTone` et `ALERT_WARNING_PCT`, rien de nouveau.
4. Session live : bandeau de pastilles en lecture, feuille au tap (3 distances, relevé, disclaimer,
   rappel du compte de la séance) ; compte de la séance inchangé.
5. « Sans plan relié » : comptes sans marge calculable seulement.
6. Démo : éval Apex vers 15-20 %, référence `nestjs/demo-seed.md` à jour.
7. Pas de maquette : captures 360, 390, 1440, gratuit et Premium, Mes comptes et Session live.
8. Textes validés : « Le plus exposé », « Sans plan relié », « Perte max du jour »,
   `ddLabels.margin.label`, « relevé il y a … », disclaimer existant, « … $ pour l'objectif ».

