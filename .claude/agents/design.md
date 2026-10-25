---
name: design
description: "Système visuel « The Terminal » : couleurs, typographies, composants, accessibilité. À lire avant toute modification d'interface."
---

# Agent Design — Système visuel MyTradingCoach · « The Terminal »

## Source de vérité

- **App trader & landing** : les composants Angular/Astro eux-mêmes sont la
  source de vérité, alignés sur les tokens de `apps/app-mytradingcoach/src/styles/theme.css`
  (l'app expédiée = référence canonique des valeurs). Les anciens miroirs statiques
  `app-mytradingcoach.html` / `landing-mytradingcoach.html` ont été retirés — ne plus s'y référer.
- Le projet **Claude Design** (`tokens/`, `components/`, `ui_kits/app/`, `guidelines/`,
  `redesign/`) est la source de vérité du *design* (maquettes, composants de référence).
- `admin-mytradingcoach.html` (racine) → référence design de l'app **admin**
  (système distinct — voir section Admin Design System en bas). La lire et la
  reproduire avant de modifier l'admin, ne pas inventer.
- Toujours passer par les tokens CSS ci-dessous, **jamais** de valeur en dur.

### Non-négociables (à chaque fois)

- **Dark only** — jamais de thème clair. Le plus sombre = `--bg` (#080c14). **Jamais #000 / #fff.**
- **Bleu = signal** (#3b82f6) : CTA et éléments interactifs uniquement.
- **Vert = gains uniquement · Rouge = pertes uniquement.** Jamais inversé, jamais décoratif.
- Toute **valeur numérique** et tout **label** = JetBrains Mono + `tabular-nums`.
- Polices : **Space Grotesk** (display), **Inter** (body), **JetBrains Mono** (mono) — Google Fonts.
- Ton produit : français, tutoiement, direct et concret (nommer le vrai problème, chiffres réels).
- **Mise en page de l'app** : chaque page occupe **toute la largeur disponible** à droite de la
  barre latérale, sans plafond (`max-width` sur le conteneur de page) ni bande vide à droite. Pour
  garder des lignes lisibles à très grande largeur, répartir les cartes en **grille à colonnes
  automatiques** (`repeat(auto-fit, minmax(min(100%, Npx), 1fr))`), pas plafonner la page. Contenu
  plus haut que l'écran : la page **défile verticalement** (aucune hauteur fixe ni `overflow:
  hidden` qui coupe la fin), **jamais de défilement horizontal**. Graphiques : tracés à la largeur
  réelle de leur carte (SVG non étiré), textes à taille fixe. **Vérifier à 360, 390, 768, 1024,
  1440, 1920 et 2560 px** (cadre iframe sur le banc : `resize_window` ne change pas le viewport).
  Les modales, feuilles et textes longs (`max-width` en `ch`) ne sont pas des pages : leur plafond
  reste permis. Plus aucune page plafonnée depuis le 25/10/2026 (sessions, parrainage, ambassadeur,
  devenir ambassadeur passés sur `.mtc-page` + `.mtc-cards`, voir plus bas).

---

## Tokens CSS — « The Terminal Palette »

```css
/* Backgrounds — 5 couches, plus on monte plus c'est proche du lecteur */
--bg: #080c14;          /* Void — base de la page */
--bg-2: #0b1219;        /* Deep — sections alternées */
--bg-3: #111b2e;        /* Raised — sous-sections, stat wells */
--bg-card: #101d2e;     /* Surface — intérieur des cartes */

/* Borders — toujours teintées bleu, jamais grises */
--border: rgba(99, 155, 255, 0.10);
--border-hover: rgba(99, 155, 255, 0.25);

/* Bleu — la seule couleur « signal » (CTA + interactif) */
--blue: #3b82f6;
--blue-bright: #60a5fa;                /* emphase, liens, hover */
--blue-glow: rgba(59, 130, 246, 0.15);

/* Statuts trading — usage STRICT */
--green: #10b981;          --green-dim: rgba(16, 185, 129, 0.12);   /* gains uniquement */
--red: #ef4444;            --red-dim: rgba(239, 68, 68, 0.12);      /* pertes uniquement */
--yellow: #f59e0b;         --yellow-dim: rgba(245, 158, 11, 0.12);  /* warnings */

/* Accents secondaires */
--purple: #8b5cf6;  --purple-bright: #a78bfa;  --purple-dim: rgba(139, 92, 246, 0.12); /* mark / beta */
--cyan: #22d3ee;                                                                        /* live / IA */
/* Partenaire — flux Tradovate uniquement (PROMPT-208) */
--nt: #ff5a1f;  --nt-dim: rgba(255, 90, 31, 0.14);  --nt-ink: #150701;  /* orange NinjaTrader, texte sur --nt */

/* Texte — 4 niveaux */
--text: #e2eaf5;        /* primaire — titres, valeurs */
--text-2: #8fa3bf;      /* secondaire — corps, descriptions */
--text-3: #8398b5;      /* muet — labels, timestamps, méta */
--text-faint: #6c84a6;  /* nav au repos, libellés de section discrets */

/* Gradient de marque — logo mark + avatars uniquement */
--grad-brand: linear-gradient(135deg, #3b82f6, #8b5cf6);

/* Typographie */
--font-display: 'Space Grotesk', sans-serif;
--font-body: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

> Les badges plan/rôle (`--badge-premium-*`, `--badge-free-*`, `--badge-beta-*`,
> `--badge-admin-*`) et les alias legacy (`--color-profit`, `--bg-primary`, `--text2`…)
> existent dans `theme.css` — les réutiliser tels quels.

---

## Typographie

| Usage | Police | Poids |
|---|---|---|
| Titres / Display | Space Grotesk | 600, 700 |
| Corps de texte | Inter | 400, 500 |
| Valeurs numériques | JetBrains Mono | 400, 500, 600 |
| Labels / badges / timestamps | JetBrains Mono | 400, 500 |

Échelle app (UI dense) : page-title 17px · greeting 22px · card-title ~14px · UI 13px · label mono 11px.

**Règle absolue :** toute valeur numérique (PnL, %, prix, R/R, compteurs) = `font-family: var(--font-mono)` + `font-variant-numeric: tabular-nums`. Idem pour les labels mono uppercase.

---

## Règles de couleur — STRICTES

| Couleur | Usage autorisé | Usage INTERDIT |
|---|---|---|
| `--green` | Gains, PnL > 0 | Décoratif, succès génériques |
| `--red` | Pertes, PnL < 0 ; session live : annonce éco à **impact fort** (ligne Prochaine annonce / Publiée), choix produit 2026-10-18 | Erreurs non-trading, danger générique |
| `--blue` | CTA, liens, éléments interactifs | Statuts trading |
| `--yellow` | Warnings, attention, urgence ; session live : annonce éco à **impact moyen** et jauge perte du jour (≥ 50 % consommés) | Succès, gains |
| `--cyan` | Indicateurs live / IA (pulse) | Décoratif, CTA |
| `--purple` | Logo mark, avatars, badge beta, chip de plan prop firm | Statuts, CTA |
| `--nt` | Flux Tradovate : carte « le plus complet », bouton « Connecter », mot « Tradovate » | Tout le reste de l'app (ce n'est pas un accent de marque MTC) |

---

## Composants — Patterns visuels

### Stat / KPI card

Cartes plates au repos, la **border s'éclaircit au hover** (`--border-hover`) + léger `translateY(-2px)`. Pas de barre d'accent `::before` sur les cartes de contenu.

```css
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card); /* 12px */
  padding: var(--pad-card);          /* 20px */
  transition: border-color .2s, transform .2s;
}
.stat-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }
```

Variante **KPI flagship** (dashboard) : `border-radius: 14px`, `padding: 18px`, fond
`linear-gradient(180deg, var(--bg-card), var(--bg-2))`, valeur en `--font-display` 27px
`tabular-nums`, glow au hover `box-shadow: 0 18px 44px -24px <glow>`.

### Panel (carte avec en-tête icône + titre + sous-titre)

```
background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
header: padding 18px 18px 0 (PAS de border-bottom); icône Lucide size 15 color var(--text-3);
        titre font-display 13.5px / 600 / letter-spacing -.2px; sous-titre mono 10px var(--text-faint);
body: padding 18px.
```

### Badge side (LONG/SHORT)

```css
.side-badge.long  { background: var(--green-dim); color: var(--green); }
.side-badge.short { background: var(--red-dim);   color: var(--red);   }
```

### Locked Feature (blocs premium)

```css
.locked-preview { filter: blur(2-3px); opacity: 0.35; pointer-events: none; }
.locked-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(8, 12, 20, 0.55-0.82); /* token --bg en rgba */
}
```

### Sélecteur de source (boutons pairs — ex. modal d'import)

Deux boutons pairs en grille `1fr 1fr` qui révèlent un panneau inline en dessous (pas de bascule-écran). L'état actif = bordure bleue + halo `box-shadow: 0 0 0 3px var(--blue-glow)` + check `var(--blue-bright)` en haut à droite. Le vert reste réservé aux repères de valeur (tag « Frais exacts ») — jamais pour l'état sélectionné.

```css
.src-btn.active {
  border-color: var(--blue);
  background: var(--blue-glow);
  box-shadow: 0 0 0 3px var(--blue-glow);
}
.src-tag-green {           /* repère de valeur, PAS l'état */
  background: var(--green-dim);
  border-color: color-mix(in srgb, var(--green) 35%, transparent);
  color: var(--green);
}
```

### Select de filtre (`.filter-select`) — aligné sur le gabarit chip

Quand une liste de filtres est dynamique ou déborde (setups, résultat, exécution, émotion…), remplacer les chips par un `<select>` stylé **au même gabarit visuel que `.filter-chip`** (même padding, radius 8px, `font-mono` 11px, bordure `--border`, actif = `--blue-glow` + `--blue`). `appearance: none` + chevron lucide en `position:absolute` à droite. L'état `.active` (filtre ≠ défaut) reprend exactement le hover bleu.

```css
.filter-select select { appearance: none; padding: 5px 26px 5px 12px; border-radius: 8px;
  font: 11px var(--font-mono); border: 1px solid var(--border); color: var(--text-2); background: transparent; }
.filter-select.active select,
.filter-select select:hover { background: var(--blue-glow); border-color: var(--blue); color: var(--blue-bright); }
.filter-select .fs-chev { position: absolute; right: 9px; opacity: .6; pointer-events: none; }
```

Bouton « Réinitialiser » associé : même gabarit, ton plus discret (`--text-3`, hover `--border-hover`). Compteur `.filter-count` en `--font-mono` `--text-3`.

### Info-bulle d'aide (`mtc-info-tooltip`) — métriques calculées

Petite icône `?` (14px, cercle bordure `--border` ; sur écran tactile, `::before` transparent qui
porte la zone de clic à 44 px sans changer le rendu — pas à la souris, il débordait sur les lignes
de semaine cliquables du journal) posée **après le libellé** d'une métrique calculée ou ambiguë, qui explique **comment la donnée est calculée** au survol / tap / focus clavier (+ Échap et clic-extérieur pour fermer). Composant partagé `shared/components/info-tooltip`.

- **Réservé aux données calculées/ambiguës** (win rate, R:R, note d'exécution, drawdown, profit factor, émotion effective, frais…). **Jamais décoratif** : pas sur Date, Actif, Direction, Entrée, Sortie, Quantité, Setup — sinon l'icône devient du bruit et l'utilisateur l'ignore.
- Uniquement sur les **en-têtes de colonnes et libellés de KPI**, jamais sur les cellules de données.
- Couleurs **neutres/bleues** uniquement (`--text-3`, hover `--blue-bright`) — jamais vert/rouge (réservés gains/pertes).
- Le contenu remet `text-transform:none` + `letter-spacing:normal` (les libellés parents sont souvent en majuscules espacées).
- Bords : `class="align-end"` (métrique la plus à droite) / `align-start` (la plus à gauche) sur `<mtc-info-tooltip>` — géré via `:host(.align-end)` — pour éviter le débordement horizontal.

### Courbes d'équité et de drawdown (`mtc-perf-chart`)

Un seul composant partagé `shared/components/perf-chart` (Chart.js via `ChartService`, séries et
formats purs dans `core/services/chart-series.util.ts`) : dashboard (équité) et Analytics (équité +
drawdown). Ne jamais recréer un graphique d'équité à part (l'ancien SVG « glow » du dashboard est retiré).

- **Carte** : `--bg-card`, `--border`, `--radius-card`, padding 20 px (24 px ≥ 768 px). Hauteur du
  tracé 210 px mobile, 280 px ≥ 768 px.
- **En-tête** : icône Lucide 14 px (`ChartSpline` équité, `TrendingDown` drawdown) + titre JetBrains
  Mono 11–12 px majuscules `.08em` `--text-2` ; à droite la valeur clé mono 14–15 px `tabular-nums`
  (équité : P&L de la période vert / rouge ; drawdown : actuel en rouge, « (max …) » si la carte
  fait ≥ 560 px). Onglets de période projetés en `[chartControls]`, info-bulle en `[chartInfo]`.
- **Ligne** 1,5 px, `cubicInterpolationMode: 'monotone'` (ne dépasse pas les vrais extrêmes),
  **aucun point** ; pastille seulement au survol. **Remplissage** : dégradé de la couleur de la ligne
  18 % → 0 % (équité : de la ligne vers le bas ; drawdown : 0 % sur la ligne de 0 → 18 % vers la courbe).
- **Couleurs** : équité verte si la période finit ≥ capital de départ, rouge sinon ; drawdown
  drawdown toujours `--red` (avec plan : courbe et limite). Lues dans les tokens au moment du tracé (un canvas ne
  lit pas `var()`), jamais en dur.
- **Grille** `--chart-grid` (rgba blanc 4 %) horizontale et verticale, sans bordure d'axe ni
  graduations ; ligne de 0 du drawdown en `--chart-zero` (12 %).
- **Axes** : JetBrains Mono 10 px (carte < 560 px) / 11 px, `--text-3`. Montants compacts
  `compactMoney` (`$135k`, `-$2.4k`, `$1.2M`, devise du compte), dates `06/01/25`, ou `janv. 25`
  au-delà de ~6 mois. Repères : 4 + 4 si carte < 560 px, sinon 7 dates / 6 montants, sans rotation.
- **Échelle** : équité `grace: '7%'` (ne part pas de 0) ; drawdown sans plan `max: 0`, bas = 108 %
  du plus profond ; drawdown avec plan : `grace: '7%'` et l'axe inclut toujours le plancher.
- **Drawdown sans plan** (« Tous les comptes », compte sans plan relié) : sous l'eau depuis 0,
  pastille + libellé `max -$4.2k · 12/03/25` (`--text-2`) au point le plus bas, aucune limite.
- **Drawdown avec plan prop firm relié** (`planFloorOf` : `metrics.drawdown.source === 'plan'`,
  montant publié) : axe en dollars du compte, du solde initial (en haut, `max`) jusqu'un peu sous la
  limite (15 % du drawdown). `Limite du plan $48,000` (= solde initial − drawdown max) en **pointillé
  simple rouge**, même style que l'objectif de la courbe d'équité (trait 1 px, `--red` 70 %), sans zone. **Courbe rouge** (`--red`) = limite + marge restante, plafonnée
  au solde initial, où marge = solde − plancher(t) et plancher(t) = `drawdownFloor` de `@mtc/shared`,
  LA fonction du suivi du compte (statique, suiveur EOD / intraday, gel). Statique → le solde lui-même ;
  suiveur → la baisse depuis le plus haut, reportée sous le solde initial. La courbe touche la limite
  exactement quand le compte touche son vrai plancher ; dernier point = `metrics.drawdown.margin`.
  « Départ » au solde initial quand la période couvre le début du compte. En-tête :
  `Marge avant la limite $1,803` + `Solde $51,078 · plancher actuel $49,275` en petit (valeurs et
  format `decimals: 0` de la séance, teinte `drawdownTone`) ; carte < 560 px → sous le titre.
  Infobulle : date + `Marge $X` seulement — **jamais la valeur de la courbe présentée comme un solde**.
  Pastille + `marge min $1,175 · 14/10` au point le plus bas. Plus de plancher en escalier.
  Tout vient du plan relié (solde initial, drawdown, type, gel, objectif) : aucune valeur propre à
  une firme ou une taille dans les composants. Plancher gelé → `Plancher gelé à $X` dans l'en-tête.
  « ? » de la carte (`drawdownHelp`) selon la règle : statique, suiveur, seuil de gel, et pour un
  suiveur intraday « Calcul sur les trades clôturés ; ta prop firm peut tenir compte des gains latents. »
- **Équité** : objectif toujours visible quand un plan est relié (`planObjectiveLine`, d'après
  `metrics.progress`, la progression du suivi du compte) — ligne pointillée verte au niveau de solde :
  Évaluation `Objectif du plan +$3,000` (départ + objectif, consistency comprise) ; Funded
  `Prochain payout $51,000` (le plus exigeant des seuils en $ : profit du cycle depuis le dernier
  payout, solde de retrait). Exigences en jours restantes ajoutées au libellé (`Jours ≥ $150 : 0 / 5`) ;
  seuil uniquement en jours (Tradeify) → légende seule, sans ligne. Sans plan : objectif saisi.
  Rien en « Tous les comptes ».
- **Axe des montants** (`spanRange`) : inclut toujours l'objectif (équité) et le plancher (drawdown),
  et couvre au moins 2 % du solde de départ de la période : quelques dollars sur un compte de 50K
  restent une ligne presque plate, pas une montagne.
- **Départ de la courbe** (`periodStartBalance`) : solde de départ du compte + P&L d'avant la
  période (`before` de l'API) ; exactement la taille du compte quand la période couvre son début
  (« Tout », aucun trade avant), moins les payouts reçus avant la période. Payouts de la période
  déduits de la courbe (fin = Capital) ; infobulle du jour : « Payout −$x » (plus « Jour ±$x » s'il
  y a eu des trades). Carte étroite (< 560 px) : onglets de période sous le titre.
- **Survol / toucher** : crosshair vertical fin + pastille + infobulle `--bg-3` (date, valeur,
  « Jour ±$x ») dessinée dans le canvas → ne sort jamais de l'écran ; `touch-action: pan-y`.
- **Animation** : découverte gauche → droite 380 ms quand les données changent, aucune si
  `prefers-reduced-motion` ou simple redimensionnement.
- **Accessibilité** : canvas `role="img"` + `aria-label` (départ, actuel, max pour le drawdown, période).

### Inscription / connexion en deux colonnes (`/register`, `/login`)

Maquette : `maquettes/maquette-register-split.html`. Seuils : **< 1024 px** formulaire seul (aucune
colonne de présentation ; téléphone : carte en haut, logo au-dessus du titre, titres centrés ;
600–1023 px : carte centrée verticalement) · **1024–1279 px** deux colonnes compactes (titre 38 px,
aperçu 90 px de haut, marges réduites) · **≥ 1280 px** version complète (titre 50 px).
- Grille `1.1fr 1fr` : présentation à gauche (`--bg` + deux halos bleu/violet en `color-mix` et
  quadrillage `--border` estompé), formulaire à droite sur `--bg-2`, séparés par `1px --border`.
- Présentation : logo, pastille mono majuscules `--blue-bright` sur `--blue-glow` (point cyan), titre
  Space Grotesk 700 (« prop firm. » en `--blue-bright`), phrase `--text-2`, six points à coche
  `--blue-bright`, étiquette **PREMIUM** violette (`--purple-bright` sur `--purple-dim`), aperçu
  « Éval Apex 50K · En séance » (3 indicateurs mono, courbe drawdown rouge, limite en pointillé
  rouge, mention « Données de démonstration » `--text-faint`), pied mono « LECTURE SEULE · HÉBERGÉ EN
  FRANCE · SANS PUBLICITÉ ».
- Colonne de présentation : logo, contenu et pied dans une même colonne de **560 px au plus, centrée**
  dans la moitié gauche (texte aligné à gauche) ; marge basse 44 px pour que le pied reste au-dessus du
  badge « interne » (fixé à 8 px du bas). Vérifié à 1024, 1280, 1440, 1920 et 2560 px.
- Carte : `--bg-card`, radius 16, titres alignés à gauche à partir de 1024 px ; champs sur `--bg`,
  44 px, radius 10 ; bouton principal 48 px, `--primary` + texte blanc (5,2:1 ; `--text` y fait 4,3:1).
  Séparateurs à libellé mono 10 px `--text-faint` (« ou », « Pas encore sûr ? »). Ligne de confiance
  mono 9,5 px `--text-faint` / `--text-3` (≥ 5:1 sur `--bg-card`), un élément par ligne quand la
  carte est trop étroite.
- Champs autoremplis par le navigateur : règle globale de `styles.css` (fond repeint, texte `--text`).
  Un anneau de focus ou d'erreur se déclare dans **`--field-ring`** (`box-shadow: var(--field-ring)`),
  jamais en `box-shadow` seul : la règle globale le garde à côté de l'ombre qui masque le fond clair.

### Navigation sidebar (barre d'accent — réservée à la nav)

```css
.nav-item.active {
  background: rgba(59, 130, 246, 0.12);
  color: var(--blue-bright);
}
.nav-item.active::before {           /* SEUL endroit où l'accent ::before est légitime */
  content: ''; position: absolute; left: 0;
  width: 3px; height: 18-20px; background: var(--blue); border-radius: 0 3px 3px 0;
}
```

### Page « Ma session » — patterns réutilisables (session-day)

La page `session` a un **header propre** (pas le `mtc-topbar` partagé). Source de vérité
des valeurs : `maquettes/new/src/session-mockup-source/` (fichiers `.jsx`/`.css` lisibles ;
le `.html` standalone n'est qu'une cible visuelle). Conteneur page : `padding: 16px 18px;
display:block; container-type:inline-size; flex:1; min-height:0; overflow-y:auto`
(espacement header/contenu via `margin-bottom:14px` sur `.mtc-sess-header`).

- **Conteneur page** : `.session-page` en `display:block` + `overflow-y:auto`. Ne **jamais** la
  repasser en `display:flex; flex-direction:column` : un conteneur flex-column **fige son
  `scrollHeight`** quand un enfant est plus haut que lui → le contenu déborde et est clippé au
  lieu de scroller (bug historique : bouton « Logger ce trade » inatteignable en laptop court).
  Les panneaux (`.qt-panel`, `.cal-card`, `.feed-col`…) se **dimensionnent à leur contenu**
  (jamais `flex:1 + overflow:hidden` pour « remplir la hauteur d'écran »).
- **Deux régimes de scroll selon la largeur** :
  - **Desktop `@container (min-width:981px)`** (header compact 1 ligne) : chaque onglet **tient
    dans l'écran**, plafonné à `max-height: calc(100vh - 103px)`, le trop-plein scrolle **à
    l'intérieur du composant** (pas d'allongement de page, header toujours visible). Cibles du
    plafond : Pré-session → les 2 colonnes `.daily-row` + `.eco-card` (liste `.eco-events` scrolle) ·
    Débrief → `.session-debrief`. **Session live v3 : pas de plafond**, la page scrolle et le bandeau
    reste collé en haut (`position: sticky`).
    Offset 103 = padding-top 16 + header 57 + margin 14 + padding-bottom 16 ; `.session-page`
    colle au haut du viewport donc `100vh` est la bonne référence (robuste aux écrans courts).
  - **Tablette/mobile `≤980px`** : **pas** de plafond → flow naturel + **scroll de page**
    (`.session-page`). Sur mobile la Pré-session repasse aussi les colonnes en `display:block;
    overflow:visible` (`@container (max-width:820px)`).
- Listes internes bornées **à partir de 821px** : `.feed-list`, `.cal-events-list` gardent `overflow-y:auto`
  borné par `max-height` sur le panneau parent (≈420px). **≤820px** (colonnes empilées) : plafond
  levé, la liste s'affiche en entier et c'est la page qui scrolle — jamais de scroll dans le scroll sur mobile.
  Session live : voir « Session live v3 » ci-dessous (media queries `min-width` 768 / 1100) ·
  `.ctx-grid` 4 col ≤1100 puis 2 col ≤680 · `.qt-pnl-row` 1 col ≤520.

- **Header** (grille `1fr auto 1fr`) : titre `Space Grotesk 21px/700 -.4px` + sous-titre
  `12.5px --text-3` (gauche) · segmented control (centre) · StartButton/SessionActivePill (droite).
- **Segmented control** (`.mtc-sess-tabs`) : `bg-2` + `border`, radius 11, padding 4 ; onglet
  `padding:8px 14px; radius:8; 12.5px`, actif = `bg-card` + `box-shadow:0 1px 3px rgba(0,0,0,.3)`
  + icône `--blue-bright`, inactif = transparent `--text-3`. Onglets : Pré-session=`Sunrise`,
  Session live=`Zap` (⚡), Débrief=`Moon`.
- **StartButton** : `green-dim`→`--green` au hover (texte `#06281c`, glow `0 0 22px rgba(16,185,129,.35)`),
  `Space Grotesk 14/700`, radius 11, border `rgba(16,185,129,.3)`.
- **SessionActivePill** : `linear-gradient(135deg, var(--green-dim), var(--bg-card))` + border
  `rgba(16,185,129,.3)`, point vert `mtc-blink 1.6s`, `SESSION ACTIVE` mono 10.5/600 `--green`,
  timer mono 16/700, compte mono 10 `--text-3`, bouton « Clôturer » (icône `moon`) neutre.
- **Cartes session** : `radius 14`, `padding 18` (banner `20`, contexte marché/live `14/16`).
  Banner Pré-session = `linear-gradient(135deg, var(--blue-glow), var(--bg-card))`. Titre de
  section = `Space Grotesk 13.5/600 --text` (pas de label mono uppercase pour ces titres).
- **MoodRow** : boutons transparents `1px --border`, sélection = border `--blue-bright` + fond
  `--blue-glow` + texte `--text` (jamais violet). Grille 2 col en fin de session, flex sinon.
- **Contexte marché** (live) : cellule `bg-2`, radius 10, valeur mono 15px, variation mono
  10.5/600 (vert/rouge), descripteur `--text-faint`, **sans barre d'accent**. Session live v3 :
  détail complet (8 tickers + news) dans la feuille « Contexte » ; le bandeau PC n'en garde que 4.
- **Anti-pattern** : ne jamais réintroduire un accent `::before` sur ces cellules/cartes, ni le
  violet sur la mood row de fin de session (bleu = sélection).
- `@keyframes mtc-blink { 0%,100%{opacity:1} 50%{opacity:.25} }` — pill session active.

### Session live v3 (#593) — mobile d'abord

Maquettes : `docs/mockups/mockup-session-live-v3-mobile.html` (390 px, référence première) et
`docs/mockups/mockup-session-live-v3.html` (PC). Base = mobile, paliers `@media (min-width: 768px)`
et `(min-width: 1100px)` ; **aucune `max-width`**, aucun scroll horizontal à 360 px.

- **Hiérarchie** : bandeau collant → prochaine annonce → trade en cours → suivi du compte →
  trades clôturés → (mobile) Contexte marché + Clôturer la session en bas de page.
- **Couleurs** : vert = gains, rouge = pertes, **cyan = live / IA** (chrono, pastille, badge LIVE,
  analyse IA d'une annonce publiée), violet = chip de plan. Ligne d'annonce : **rouge si impact
  fort, ambre si impact moyen** (couleur = impact le plus fort du créneau) ; ambre aussi pour la jauge
  perte du jour. Plusieurs annonces à la même heure : **une seule ligne**, la plus importante en
  tête, chip « +N » qui déplie une liste compacte (point de couleur + nom + impact) ; publiées : « N
  PUBLIÉES », les autres dans le dépliage sur 2 niveaux (nom ; publié · prévu · précédent en gris),
  un seul « J'ai lu » sur la ligne du titre. **≥ 2 annonces fortes** : avant publication toutes
  nommées (« 2 ANNONCES FORTES »), « +N » pour les moyennes seulement ; publiées, un **onglet** par
  annonce forte (nom court, 44 px, une ligne qui glisse), la plus surprenante (écart publié / prévu)
  ouverte d'abord, point cyan sur une analyse pas encore lue ; une seule analyse visible à la fois. Chiffres publiés d'une annonce : neutres (au-dessus de la
  prévision n'est ni un gain ni une perte). Variations de marché du bandeau : vert / rouge.
- **Jauges** (libellé + valeur à droite, barre 8 px radius 99, sous-ligne 12 px `--text-2`) :
  perte max du jour = part **consommée**, neutre `--text-faint` < 50 %, ambre ≥ 50 %, rouge ≥ 75 %
  (seuils `drawdownTone`, comme « Mes comptes » — pas de seuil propre) ; marge plancher = gris
  ardoise `--text-faint` ; objectif = vert. Teaser Premium : même place, même hauteur (78 px),
  une ligne, bordure pointillée, badge violet.
- **Barre SL / entrée / TP** : piste `--bg-3` 10 px, segment perte `--red` 35 %, gain `--green` 28 %,
  trait d'entrée 2×20 px `--text`, pastille 18 px (rouge en perte, verte en gain). Libellés :
  montants sous les prix jusqu'à 1100 px, sur la même ligne au-delà.
- **Typo** : actif Space Grotesk 24 px (28 PC), latent JetBrains Mono 32 px (40 PC), libellés de
  carte JetBrains Mono 11 px `.08em` majuscules `--text-2`. Texte jamais < 12 px, cibles ≥ 44 px
  en mobile (≥ 40 px en PC). **Aucun emoji** dans la vue (humeur en texte seul).
- **Clôturer la session** : rouge discret (bordure rouge 45 %, fond rouge 8 %, texte rouge éclairci),
  bien séparé de « Clôturer ce trade » (neutre `--bg-3`).

---

## Dimensions fixes

| Élément | Token | Valeur |
|---|---|---|
| Topbar height | `--topbar-h` (theme.css) | **56px** (mode hero 60 px, Ma session) |
| Bordure basse topbar | `--topbar-border-w` | 1px |
| Boutons topbar mobile (Discord, burger) | `--topbar-btn-h` | 31px |
| Bandeau démo mobile | `--demo-banner-h-mobile` | 52px |
| Zone tactile minimale | `--tap-min` | 44px |
| Sidebar width | `--sidebar-w` | 220px (repliée `--sidebar-w-collapsed` 68px) |
| Gutter contenu | `--pad-content` | 30px |
| Padding carte | `--pad-card` | 20px |
| Gap grille | `--gap-grid` | 16px |
| Radius badges/chips | `--radius-sm` | 6px |
| Radius boutons/inputs/nav | `--radius-btn` | 8px |
| Radius cards/panels | `--radius-card` | 12px |
| Radius cartes featured | `--radius-lg` | 14px |
| Radius modals | `--radius-modal` | 16px |
| Radius pills | `--radius-pill` | 100px |

**Burger mobile (≤ 768 px)** : bouton de la sidebar en `position: fixed` POSÉ PAR-DESSUS la topbar
(aucun lien DOM). Hauteur `--topbar-btn-h` (= Discord voisin), centré dans la hauteur utile
`(--topbar-h − --topbar-border-w − --topbar-btn-h) / 2` (idem dans le bandeau démo), zone tactile
`::before` de `--tap-min` qui reste dans l'en-tête. Toucher la hauteur de la topbar ou de ses
boutons = passer par ces variables ; `topbar-burger-alignment.spec.ts` lit les CSS et échoue sinon.
Avant (40 px, `top: 14px` en dur) : 9 px de plus que Discord, centre 6 px trop bas, bas à 2 px de la ligne.
Pages du shell SANS topbar (en-tête propre) : le burger y reste à la même place. Ma session est
calée dessus en mobile (`padding-top` + `line-height: var(--topbar-btn-h)` du titre). Les autres
(Mes sessions, Calendrier éco, Parrainage, Ambassadeur, Devenir ambassadeur) utilisent les classes
COMMUNES de `styles.css` :
- `.mtc-page` sur le conteneur : padding `--page-pad` (mobile : 0 en haut, `--page-pad-mobile`),
  aucun `max-width`. Le padding du conteneur ne vit QUE là : une règle de composant (spécificité
  plus forte) l'écraserait.
- `.mtc-page-head` sur l'en-tête : en mobile, `padding-top` = haut du burger et place réservée à
  droite (`--topbar-burger-space` − `--page-pad-mobile`) : rien ne passe sous le burger.
- `.mtc-page-title` sur le h1, PREMIER élément de l'en-tête : en mobile, `line-height:
  var(--topbar-btn-h)`, sa ligne a la boîte du burger. Un lien retour va APRÈS le titre dans le DOM
  (`order: -1` en bureau pour l'afficher au-dessus).
- `.mtc-cards` : grille `repeat(auto-fit, minmax(min(100%, var(--cards-min, --card-col-min)), 1fr))`,
  `--cards-min` réglé par section (420/520/760 px). Grouper par paires : une grille auto-fit de 2
  cartes n'a jamais de trou. Garder les 4 stats en 4 → 2 colonnes fixes (4 sur 3 colonnes = trou).
Nouvelle page sans topbar : lui mettre ces classes ; le spec tient l'inventaire et échoue sinon.

---

## Dark mode — UNIQUEMENT

- Jamais de fond blanc, jamais de thème clair.
- Background le plus sombre : `var(--bg)` = `#080c14`. Jamais `#000` ni `#fff`.
- **Seule exception (validée par Greg, #525)** : le panneau du formulaire de la page de paiement
  (`features/checkout`) est clair (`#ffffff`, champs `#f8fafc`) pour la lisibilité du paiement. Ses
  couleurs sont locales au composant (`--pay-*`) ; le reste de la page suit le thème sombre.

---

## Icônes

- `lucide-angular` exclusivement dans l'app Angular.
- Taille : 14-16px dans la sidebar, 15-20px dans le contenu. Stroke 1.5-2px.
- **Jamais d'emoji** dans les composants Angular — *sauf* les émotions trader
  (et watermarks/nav décoratifs assumés par le design).
- **Icônes de l'app installée (PWA)** : `apps/app-mytradingcoach/public/pwa/`, générées depuis le
  tracé de `logo.svg` par `tools/scripts/generate-app-icons.mjs` (dégradé `--blue` → `--purple`,
  courbe `--text`, lus dans `theme.css`). Jamais retouchées à la main : modifier le script et relancer.

---

## Élévation & animations

```css
/* Ombres — structurelles/interactives, jamais décoratives ambiantes */
--shadow-pie: 0 8px 24px -8px rgba(0,0,0,.6);    /* widgets circulaires */
--glow-blue:  0 0 28px rgba(59,130,246,.4);      /* glow CTA primaire */

/* Transitions */
transition: all .15s;          /* hover rapide (--ease-hover) */
transition: all .2s;           /* états actif/focus (--ease-state) */
transition: transform .2s;     /* cartes au hover (--ease-card) */
--ease-fill: 1s cubic-bezier(.4,0,.2,1); /* remplissages de barres, tracé equity */

/* Pulse live/IA */
@keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.8); } }
@keyframes bounce { 0%,80%,100% { transform:translateY(0); } 40% { transform:translateY(-5px); } }
```

---

## Admin Design System — `admin-mytradingcoach`

L'app admin utilise un design system différent de l'app principale.
Ne pas mélanger les variables CSS des deux apps.

```css
/* Admin uniquement — dans apps/admin-mytradingcoach/src/styles.css */
:root {
  --bg:        #070809;
  --bg2:       #0c0e10;
  --bg3:       #111416;
  --bg4:       #171a1d;
  --border:    rgba(255,255,255,0.06);
  --text:      #e8eaed;
  --text2:     #9aa3af;
  --text3:     #4a5568;
  --teal:      #00d4aa;
  --teal-dim:  rgba(0,212,170,0.08);
  --blue:      #4a9eff;
  --red:       #ff5563;
  --amber:     #f5a623;
  --green:     #34d399;
  --mono:      'Geist Mono', monospace;
  --sans:      'Geist', sans-serif;
}
```

Fonts admin : Geist + Geist Mono (Google Fonts) — pas JetBrains Mono / Space Grotesk / Inter.
