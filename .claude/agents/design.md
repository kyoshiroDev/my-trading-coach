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
| `--red` | Pertes, PnL < 0 | Erreurs non-trading, danger générique |
| `--blue` | CTA, liens, éléments interactifs | Statuts trading |
| `--yellow` | Warnings, attention, urgence | Succès, gains |
| `--cyan` | Indicateurs live / IA (pulse) | Décoratif, CTA |
| `--purple` | Logo mark, avatars, badge beta | Statuts, CTA |
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

Petite icône `?` (14px, cercle bordure `--border`) posée **après le libellé** d'une métrique calculée ou ambiguë, qui explique **comment la donnée est calculée** au survol / tap / focus clavier (+ Échap et clic-extérieur pour fermer). Composant partagé `shared/components/info-tooltip`.

- **Réservé aux données calculées/ambiguës** (win rate, R:R, note d'exécution, drawdown, profit factor, émotion effective, frais…). **Jamais décoratif** : pas sur Date, Actif, Direction, Entrée, Sortie, Quantité, Setup — sinon l'icône devient du bruit et l'utilisateur l'ignore.
- Uniquement sur les **en-têtes de colonnes et libellés de KPI**, jamais sur les cellules de données.
- Couleurs **neutres/bleues** uniquement (`--text-3`, hover `--blue-bright`) — jamais vert/rouge (réservés gains/pertes).
- Le contenu remet `text-transform:none` + `letter-spacing:normal` (les libellés parents sont souvent en majuscules espacées).
- Bords : `class="align-end"` (métrique la plus à droite) / `align-start` (la plus à gauche) sur `<mtc-info-tooltip>` — géré via `:host(.align-end)` — pour éviter le débordement horizontal.

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
    Session live → `[data-testid="session-live-view"]` · Débrief → `.session-debrief`.
    Offset 103 = padding-top 16 + header 57 + margin 14 + padding-bottom 16 ; `.session-page`
    colle au haut du viewport donc `100vh` est la bonne référence (robuste aux écrans courts).
  - **Tablette/mobile `≤980px`** : **pas** de plafond → flow naturel + **scroll de page**
    (`.session-page`). Sur mobile la Pré-session repasse aussi les colonnes en `display:block;
    overflow:visible` (`@container (max-width:820px)`).
- Listes internes toujours bornées : `.feed-list`, `.cal-events-list` gardent `overflow-y:auto`
  borné par `max-height` sur le panneau parent (≈420px). Container-queries live : `.live-layout`
  1 col ≤1100 · `.live-cols` 1 col ≤820 · `.mini-stats-row` 2 col ≤820 puis 1 col ≤520 ·
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
  10.5/600 (vert/rouge), descripteur `--text-faint`, **sans barre d'accent**. Contexte + grille
  + news ticker dans **une seule carte** (`.mkt-card`).
- **Anti-pattern** : ne jamais réintroduire un accent `::before` sur ces cellules/cartes, ni le
  violet sur la mood row de fin de session (bleu = sélection).
- `@keyframes mtc-blink { 0%,100%{opacity:1} 50%{opacity:.25} }` — pill session active.

---

## Dimensions fixes

| Élément | Token | Valeur |
|---|---|---|
| Topbar height | `--topbar-h` | **60px** |
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

---

## Dark mode — UNIQUEMENT

- Jamais de fond blanc, jamais de thème clair.
- Background le plus sombre : `var(--bg)` = `#080c14`. Jamais `#000` ni `#fff`.

---

## Icônes

- `lucide-angular` exclusivement dans l'app Angular.
- Taille : 14-16px dans la sidebar, 15-20px dans le contenu. Stroke 1.5-2px.
- **Jamais d'emoji** dans les composants Angular — *sauf* les émotions trader
  (et watermarks/nav décoratifs assumés par le design).

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
