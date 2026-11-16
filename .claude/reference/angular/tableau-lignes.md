# Tableau de lignes partagé (Journal · Mes comptes)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Tableau de lignes — pattern partagé (Journal · Mes comptes) · 2026-09-20 -->
> **Origine** : `angular.md` · « Tableau de lignes — pattern partagé (Journal · Mes comptes) » · 2026-09-20

## Tableau de lignes — pattern partagé (Journal · Mes comptes)

Une liste d'objets comparables (trades, comptes) s'affiche en **lignes alignées**, jamais en
grille de cartes : les cartes ne tiennent pas la montée en charge (6 comptes = un mur) et
laissent un trou quand le compte est impair. Le pattern, identique dans `journal.component.css`
et `accounts.component.css` :

- un **en-tête de colonnes** (`.table-header` / `.acct-thead`) et les lignes partagent LE MÊME
  `grid-template-columns` — deux déclarations à garder synchronisées, sinon l'alignement casse ;
- libellés d'en-tête en mono 9 px, majuscules, `letter-spacing: .1em`, `color: var(--text-3)` ;
- pas d'`overflow: hidden` sur le wrapper si une ligne ouvre un menu « … » : il serait coupé ;
- menu « … » de Mes comptes **rendu hors du tableau** (un seul, en fin de gabarit, `position: fixed`,
  `z-index: 900`, ancré au bouton par `menuPositionFor`, ouvert vers le haut près du bas de l'écran,
  suit le défilement, fermé par Échap ou clic extérieur). Dans la ligne, l'`opacity` d'un compte
  archivé créait un contexte d'empilement : menu translucide et ligne suivante au-dessus, qui
  recevait le clic. Test réel : `app-mytradingcoach-e2e/src/14-accounts-menu.spec.ts` (API simulée) ;
- « Supprimer » d'un compte **ARCHIVÉ** (Mes comptes) = suppression définitive du compte et de ses
  trades : `GET deletion-preview` (nombre exact), `ConfirmService` danger (nom, N trades, connexion
  Tradovate, « Action définitive »), puis `DELETE /accounts/:id/archived` ; `store.load()`,
  `tradesStore.reset()`, `tv.load()`. Un compte non archivé garde `DELETE /accounts/:id` (archivage) ;
- repli mobile : `.table-header { display: none }`, la ligne repasse en grille de 2-3 colonnes et
  chaque cellule retrouve son étiquette via `content: attr(data-label)` ;
- ce qui ne tient pas à l'écran étroit passe derrière un **dépli** (signal `expandedId`, une
  ligne ouverte à la fois), jamais derrière un scroll horizontal ;
- la bascule en repli suit la largeur du **tableau** (`container: acct-table / inline-size` +
  `@container acct-table (max-width: 980px)`), pas celle de la fenêtre : la barre latérale prend
  70 à 216 px, et un seuil en `@media` laissait les colonnes se chevaucher (Mes comptes à 1100 px).

⚠️ **Deux pièges de sélecteurs**, tous deux rencontrés en vrai sur « Mes comptes » :
- `:nth-of-type()` compte les **éléments** (tous les `div`), pas les classes : `.cell.num:nth-of-type(2)`
  ne désigne pas la 2ᵉ cellule numérique. Donner une classe explicite à chaque colonne
  (`.cell-balance`, `.cell-pnl`…) ;
- une règle de repli doit **battre en spécificité** la règle desktop : `.cell.num.right` (3 classes)
  gagne contre `.cell.num` même placé plus bas dans le fichier → écrire `.acct-line .cell.num.right`.

Les actions attendues par les tests (synchro, déconnexion) restent **dans le DOM sans interaction** :
les enfermer dans un menu `@if` casse les specs qui les interrogent au rendu.
