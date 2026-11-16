# Composants : patterns visuels de base

> Contenu déplacé à l'identique depuis `.claude/agents/design.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : design.md · Composants — Patterns visuels · 2026-04-25 -->
> **Origine** : `design.md` · « Composants — Patterns visuels » · 2026-04-25

## Composants — Patterns visuels

<!-- Origine : design.md · Stat / KPI card · 2026-06-30 -->
> **Origine** : `design.md` · « Stat / KPI card » · 2026-06-30

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

<!-- Origine : design.md · Panel (carte avec en-tête icône + titre + sous-titre) · 2026-06-30 -->
> **Origine** : `design.md` · « Panel (carte avec en-tête icône + titre + sous-titre) » · 2026-06-30

### Panel (carte avec en-tête icône + titre + sous-titre)

```
background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
header: padding 18px 18px 0 (PAS de border-bottom); icône Lucide size 15 color var(--text-3);
        titre font-display 13.5px / 600 / letter-spacing -.2px; sous-titre mono 10px var(--text-faint);
body: padding 18px.
```

<!-- Origine : design.md · Badge side (LONG/SHORT) · 2026-04-25 -->
> **Origine** : `design.md` · « Badge side (LONG/SHORT) » · 2026-04-25

### Badge side (LONG/SHORT)

```css
.side-badge.long  { background: var(--green-dim); color: var(--green); }
.side-badge.short { background: var(--red-dim);   color: var(--red);   }
```

<!-- Origine : design.md · Locked Feature (blocs premium) · 2026-04-25 -->
> **Origine** : `design.md` · « Locked Feature (blocs premium) » · 2026-04-25

### Locked Feature (blocs premium)

```css
.locked-preview { filter: blur(2-3px); opacity: 0.35; pointer-events: none; }
.locked-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(8, 12, 20, 0.55-0.82); /* token --bg en rgba */
}
```

<!-- Origine : design.md · Sélecteur de source (boutons pairs — ex. modal d'import) · 2026-07-18 -->
> **Origine** : `design.md` · « Sélecteur de source (boutons pairs — ex. modal d'import) » · 2026-07-18

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

<!-- Origine : design.md · Select de filtre (`.filter-select`) — aligné sur le gabarit chip · 2026-07-18 -->
> **Origine** : `design.md` · « Select de filtre (`.filter-select`) — aligné sur le gabarit chip » · 2026-07-18

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

<!-- Origine : design.md · Info-bulle d'aide (`mtc-info-tooltip`) — métriques calculées · 2026-07-18 -->
> **Origine** : `design.md` · « Info-bulle d'aide (`mtc-info-tooltip`) — métriques calculées » · 2026-07-18

### Info-bulle d'aide (`mtc-info-tooltip`) — métriques calculées

Petite icône `?` (14px, cercle bordure `--border` ; sur écran tactile, `::before` transparent qui
porte la zone de clic à 44 px sans changer le rendu — pas à la souris, il débordait sur les lignes
de semaine cliquables du journal) posée **après le libellé** d'une métrique calculée ou ambiguë, qui explique **comment la donnée est calculée** au survol / tap / focus clavier (+ Échap et clic-extérieur pour fermer). Composant partagé `shared/components/info-tooltip`.

- **Réservé aux données calculées/ambiguës** (win rate, R:R, note d'exécution, drawdown, profit factor, émotion effective, frais…). **Jamais décoratif** : pas sur Date, Actif, Direction, Entrée, Sortie, Quantité, Setup — sinon l'icône devient du bruit et l'utilisateur l'ignore.
- Uniquement sur les **en-têtes de colonnes et libellés de KPI**, jamais sur les cellules de données.
- Couleurs **neutres/bleues** uniquement (`--text-3`, hover `--blue-bright`) — jamais vert/rouge (réservés gains/pertes).
- Le contenu remet `text-transform:none` + `letter-spacing:normal` (les libellés parents sont souvent en majuscules espacées).
- Bords : `class="align-end"` (métrique la plus à droite) / `align-start` (la plus à gauche) sur `<mtc-info-tooltip>` — géré via `:host(.align-end)` — pour éviter le débordement horizontal.

<!-- Origine : design.md · Navigation sidebar (barre d'accent — réservée à la nav) · 2026-06-30 -->
> **Origine** : `design.md` · « Navigation sidebar (barre d'accent — réservée à la nav) » · 2026-06-30

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
