---
name: angular
description: "À appeler pour vérifier un diff qui touche apps/app-mytradingcoach, apps/admin-mytradingcoach ou libs/front (composants, stores, routes, styles). À lire aussi avant de coder dans l'app ou l'admin : règles permanentes + index des références."
tools: Read, Grep, Glob, Bash
---

# Agent Angular — app-mytradingcoach

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- apps/app-mytradingcoach apps/admin-mytradingcoach libs/front`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Templates : `@if` / `@for` / `@switch`, jamais `*ngIf` / `*ngFor`.
2. Standalone, préfixe `mtc-`, `inject()`, signals (`signal`, `computed`, `effect`, `toSignal`), `DestroyRef`, `OnPush` sans signals.
3. CSS dans le `.css`, jamais inline dans le `.ts` ; couleurs et espacements par variables du thème (`var(--…)`), aucune valeur en dur.
4. Icônes `@lucide/angular` seulement (motif `<svg [lucideIcon]>`), cadenas = icône `Lock`, jamais d'emoji.
5. Responsive : `input/select/textarea` 16 px sous 768 px, `min-width: 0`, `minmax(0, 1fr)`, un seul scroll vertical, safe-area, testé à 360 et 390 px.
6. `data-testid` sur les éléments interactifs nouveaux (liste de la section « data-testid obligatoires »).
7. Erreurs : toute mutation a une branche `error` avec message affiché, `404` de suppression = succès, toute donnée chargée affiche son échec (`mtc-error-state`).
8. Polling : `visibleInterval` (app) / `visiblePoll` (admin), jamais `interval()` / `setInterval()` ; socket avec `SOCKET_RECONNECT_OPTIONS`.
9. Montants : pipes / `MoneyService`, devise du compte, P&L net (`netPnl`) ; capital, courbe et drawdown par la définition unique.
10. Paywalls : `isPremium()` et libellé unique `PaywallCtaService` ; prix, durées et avantages depuis `@mtc/shared` / `PRICING`.
11. Jamais `window.confirm()` (`ConfirmService`) ; toute modale avec `mtcDialog`.
12. Bundle initial sous le budget (marge à surveiller) : composant lourd en `@defer`.
13. Admin : conforme à la maquette `admin-mytradingcoach.html` ; app : conforme au composant et à la maquette `maquette-*.html` si elle existe.
14. Compte démo : affichage vérifié (lecture seule, données du seed).

Réponse, toujours ce format, court :
```
Domaine : angular
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

## Stack
Angular 22 · Signals · Standalone Components · @lucide/angular · Vitest · Nx 23 · TypeScript 6.0

---

## Règles Angular 22 — ABSOLUES

- `@if` / `@for` / `@switch` dans les templates — jamais `*ngIf` / `*ngFor`
- `inject()` plutôt que constructeur
- `DestroyRef` à la place de `ngOnDestroy`
- `signal()`, `computed()`, `effect()`, `toSignal()` — signals partout
- `@defer` pour le lazy loading des composants lourds
- Standalone Components exclusivement — pas de NgModules
- Prefix composants : `mtc-`
- Icônes : `@lucide/angular` exclusivement (jamais d'autres libs d'icônes). Motif :
  `<svg [lucideIcon]="XIcon" [size]="16" class="…" />` avec `LucideDynamicIcon` dans `imports`
  et `import { LucideX as X } from '@lucide/angular'` (le `<svg>` EST l'icône, classe `lucide`
  posée par la librairie → CSS sur `svg.lucide`, jamais sur `lucide-icon`). La librairie réécrit
  l'attribut `class` à chaque rendu : pas de `[class.x]` sur l'icône, passer par `[class]`.
- CSS dans `.css` uniquement — jamais inline dans `.ts`
- `OnPush` sur les composants sans signals

## Responsive mobile — OBLIGATOIRE sur tous les composants

- `font-size: 16px` minimum sur tous les `input`, `select`, `textarea` — anti-zoom iOS Safari
- `min-width: 0` sur tous les items grid/flex — anti-overflow
- `overflow-x: hidden` sur les containers principaux — `.main-content` (sidebar) le porte : un
  `overflow-y:auto` seul passe `overflow-x` à `auto` et un enfant trop large fait glisser toute la page
- Grilles repliées en 1 colonne : `minmax(0, 1fr)`, jamais `1fr` nu (= `minmax(auto, 1fr)` : la piste
  s'élargit au min-content du contenu, ex. heatmap, champ de lien, profil → page plus large que l'écran)
- Barre flex passée en `flex-direction: column` : retirer le `flex-wrap: wrap` (avec le wrap, le
  stretch ne borne plus la largeur des enfants — filtres du Journal à 997 px)
- `overflow-x: hidden` sur `.main-content` **masque** un débordement, il ne le corrige pas : le
  contenu est rogné à droite (KPI, cartes). Toujours tester à **360 px** (le plus étroit courant) :
  rangée flex d'un item qui « wrappe » un enfant `flex:1` → l'item lui-même a besoin de
  `flex:1; min-width:0` (sélecteur de compte) ; valeur + visuel côte à côte dans une carte de
  ~156 px → `flex-wrap` ; en-tête titre + onglets → `flex-wrap`
- **Texte à côté d'un montant** (sélecteur de compte, #879) : chaque ligne de texte en `nowrap` porte
  sa troncature (`min-width:0; overflow:hidden; text-overflow:ellipsis`, badge en `flex-shrink:0`),
  le montant est `nowrap; flex-shrink:0` (jamais coupé). Un `nowrap` sans `overflow` déborde SOUS
  le montant voisin. Sélecteur ≤ 480 px : bouton en grille sur deux lignes (nom en haut sur toute la
  largeur ; type · firme + solde dessous, `justify-items:start` sinon le texte se centre). Verrouillé
  par `app-mytradingcoach-e2e/src/14-account-selector-layout.spec.ts` (320/360/390/768/1280 px,
  boîtes mesurées).
- **Un seul scroll vertical sur mobile** : `.main-content`. Pas de bloc `overflow-y:auto` borné
  (`max-height`, `flex:1 + min-height:0`) sous 768px — Mes comptes, calendrier éco, live feed.
  Un débordement horizontal voulu (tableau, onglets, carrousel) porte son propre `overflow-x:auto`
- `padding-bottom: calc(env(safe-area-inset-bottom) + Xpx)` sur les footers fixes **et sur le
  conteneur de page** sous 768px (`.content` du dashboard / journal, `.session-page`) : avec
  `viewport-fit=cover`, sans ça la fin de la page passe sous la barre système iOS (#440)
- `height: 100dvh` plutôt que `100vh` — évite le bug Safari barre d'adresse
- `viewport-fit=cover` dans `index.html`

```css
/* Règle globale dans chaque composant .css */
@media (max-width: 768px) {
  input, select, textarea { font-size: 16px; }
}
```

---

## Conventions CSS

```css
/* Variables à utiliser — jamais de valeurs hardcodées */
var(--bg) var(--bg-2) var(--bg-3) var(--bg-card)
var(--border) var(--border-hover)
var(--blue) var(--blue-bright) var(--blue-glow)
var(--green) var(--green-dim)
var(--red) var(--red-dim)
var(--yellow)
var(--text) var(--text-2) var(--text-3)
var(--font-display) var(--font-body) var(--font-mono)
```

---

## Blocs verrouillés (teaser + overlay)

Deux approches : le composant partagé `mtc-premium-lock` (simple), ou l'overlay
teaser flouté pour les vues riches. **Le cadenas est une icône Lucide `Lock`**
(ou un SVG inline au tracé Lucide) — plus jamais l'emoji 🔒 (incohérent avec les
autres icônes). L'aperçu derrière l'overlay est un **mock** (jamais la vraie donnée
→ pas de fuite).

```html
<div class="locked-feature">
  <div class="locked-preview" aria-hidden="true">
    <!-- aperçu MOCK flou du contenu -->
  </div>
  <div class="locked-overlay">
    <span class="locked-icon">
      <lucide-icon [img]="LockIcon" [size]="20" /> <!-- ou svg inline tracé Lucide -->
    </span>
    <h3>Titre de la feature</h3>
    <p>Description de la valeur ajoutée</p>
    <button (click)="showPlanModal.set(true)">Débloquer →</button>
  </div>
</div>
```

---

## data-testid obligatoires

```html
<!-- Auth -->
<input data-testid="login-email" />
<input data-testid="login-password" />
<button data-testid="login-submit" />

<!-- Journal -->
<button data-testid="add-trade-btn" />
<div data-testid="trades-list" />
<div data-testid="win-rate" />
<div data-testid="pnl-total" />
<table data-testid="heatmap" />
<div data-testid="locked-overlay" />

<!-- Dashboard V2 — Session Mode (BETA_TESTER + ADMIN) -->
<button data-testid="tab-dashboard" />
<button data-testid="tab-morning" />
<button data-testid="tab-live" />
<div data-testid="session-morning-view" />
<div data-testid="session-live-view" />
<button data-testid="mood-confident" />
<button data-testid="mood-focused" />
<button data-testid="mood-neutral" />
<button data-testid="mood-tired" />
<button data-testid="start-session" />
<button data-testid="close-session" />
<div data-testid="yesterday-recap" />
<div data-testid="today-objectives" />
<div data-testid="eco-calendar" />
<div data-testid="live-feed" />
<div data-testid="quick-trade-form" />
<input data-testid="quick-trade-asset" />
<button data-testid="quick-trade-long" />
<button data-testid="quick-trade-short" />
<button data-testid="quick-trade-submit" />
<div data-testid="trade-close-panel" />
<input data-testid="trade-exit-price" />
<div data-testid="trade-close-type" />
```

---

---

## Règles détaillées (résumé : détail dans `reference/angular/regles-detail.md`)

- **Budget du bundle initial** (règle du 2026-10-26) : marge à surveiller, la page d'inscription est chargée d'office.
- **Gestion erreurs API** : toute mutation a une branche `error` qui écrit un message affiché ; un `404` sur une suppression vaut succès ; jamais figer un objet dérivé dans un signal.
- **Environments** : API locale sur 3001 (`environment.ts`), voir le détail.
- **Source de vérité design** : le composant (`*.component.html`) et les maquettes `maquette-*.html` ; admin = `admin-mytradingcoach.html`.
- **Polling : `visibleInterval` obligatoire** (SCA-B4) : jamais `interval()` / `setInterval()` pour interroger l'API ; donnée commune poussée par socket ; admin : `visiblePoll`.
- **Pipes obligatoires** (`reference/angular/pipes.md`) : devise du compte, zéro conversion ; P&L affiché = net (`netPnl`) ; capital, courbe et drawdown : une seule définition.
- **Libs front** (`reference/angular/libs-front.md`) : jamais `window.confirm()` (`ConfirmService`), toute modale avec `mtcDialog`, toute donnée chargée affiche son échec (`mtc-error-state`).
- **Features gated** (`reference/angular/features-gated.md`) : `isPremium()` côté front, libellé unique des paywalls via `PaywallCtaService`.

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `angular/autoremplissage-profil.md` | formulaires d'auth (autoremplissage), Profil |
| `angular/comptes-prop-firm.md` | Mes comptes : plan prop firm relié, synchro en pause |
| `angular/features-gated.md` | paywall, cadenas, libellés d'accès Premium |
| `angular/feedback-utilisateur.md` | toast, message inline, bloc persistant |
| `angular/historique-audit-2026-09.md` | couche HTTP, découpage dashboard / session-live, migration Angular 22 |
| `angular/journal-rr-stop.md` | R/R et stop initial dans le Journal |
| `angular/libs-front.md` | modales, ConfirmService, routeur, stores, listes vides, formulaires, contrastes |
| `angular/pipes.md` | affichage d'un montant, d'une devise, du capital ou du drawdown |
| `angular/pwa-installation.md` | manifest, parcours d'installation de l'app |
| `angular/regles-detail.md` | budget du bundle, erreurs API et suppressions, environnements, polling / sockets |
| `angular/structure-et-routes.md` | nouvel écran, route, store, ou notes d'un écran existant (session, onboarding, admin) |
| `angular/tableau-lignes.md` | tableau de lignes (Journal, Mes comptes) |
| `commun/acquisition-inscription.md` | UTM, `source` d'inscription, écran Acquisition |
| `commun/autopsie-669.md` | autopsie d'un compte grillé (API, écran, schéma, tests) |
| `commun/calendrier-eco.md` | calendrier économique, relevés FMP, analyses IA des annonces |
| `commun/compte-perdu.md` | compte échoué / archivé, agrégats qui les excluent |
| `commun/connexion-google.md` | connexion / inscription Google, OAuth, liaison de compte |
| `commun/contrat-front-api.md` | nouvelle route ou réponse partagée front ↔ API |
| `commun/demo-cta-1029.md` | bandeau de la démo, campagnes de test exclues des stats |
| `commun/entonnoir-premium.md` | événements produit, entonnoir, mesures de conversion |
| `commun/essai-premium.md` | essai d'inscription 14 j, essai Stripe 30 j, fin d'essai, libellés d'essai |
| `commun/liaison-discord.md` | liaison Discord par code |
| `commun/mtc-shared.md` | ajout ou usage d'un calcul, type ou constante de `@mtc/shared` |
| `commun/offre-fondateur.md` | offre fondateur, places, codes partenaires, route publique `/pricing/founder` |
| `commun/payouts.md` | payouts d'un compte funded (saisis ou détectés) |
| `commun/push-admin.md` | notifications push / PWA de l'admin |
| `commun/push-traders.md` | notifications push des traders |
| `commun/seances-et-chiffres-947.md` | séance du jour, clôture, totaux de séance, périodes et chiffres affichés |
| `commun/synchro-broker.md` | synchro Tradovate / NinjaTrader, OAuth broker, temps réel, connexion broker d'un compte |
