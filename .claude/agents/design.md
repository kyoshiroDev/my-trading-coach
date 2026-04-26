# Agent Design — Système visuel MyTradingCoach

## Source de vérité

- `app-mytradingcoach.html` → référence design app Angular
- `landing-mytradingcoach.html` → référence design landing Astro
- **Ne jamais inventer** — reproduire exactement ces fichiers

---

## Tokens CSS

```css
/* Backgrounds */
--bg: #080c14;
--bg-2: #0d1420;
--bg-3: #111b2e;
--bg-card: #0f1824;

/* Borders */
--border: rgba(99, 155, 255, 0.1);
--border-hover: rgba(99, 155, 255, 0.25);

/* Couleurs principales */
--blue: #3b82f6;
--blue-bright: #60a5fa;
--blue-glow: rgba(59, 130, 246, 0.15);

/* Statuts trading — usage strict */
--green: #10b981;          /* gains uniquement */
--green-dim: rgba(16, 185, 129, 0.12);
--red: #ef4444;             /* pertes uniquement */
--red-dim: rgba(239, 68, 68, 0.12);
--yellow: #f59e0b;          /* warnings */

/* Texte */
--text: #e2eaf5;            /* primaire */
--text-2: #8fa3bf;          /* secondaire */
--text-3: #4a6080;          /* tertiaire / labels */

/* Typographie */
--font-display: 'Syne', sans-serif;
--font-body: 'DM Sans', sans-serif;
--font-mono: 'DM Mono', monospace;
```

---

## Typographie

| Usage | Police | Poids |
|---|---|---|
| Titres / Display | Syne | 700, 800 |
| Corps de texte | DM Sans | 400, 500 |
| Valeurs numériques | DM Mono | 400, 500 |
| Labels / badges | DM Mono | 400, 500 |

**Règle absolue :** Toutes les valeurs numériques (PnL, %, prix, R/R, trades count) = `font-family: var(--font-mono)`.

---

## Règles de couleur — STRICTES

| Couleur | Usage autorisé | Usage INTERDIT |
|---|---|---|
| `--green` | Gains positifs, PnL > 0 | Décoratif, succès génériques |
| `--red` | Pertes négatives, PnL < 0 | Erreurs non-trading, danger |
| `--blue` | Actions, liens, CTA | Statuts trading |
| `--yellow` | Warnings, attention | Succès, gains |

---

## Composants — Patterns visuels

### Stat Card

```css
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  transition: border-color .2s, transform .2s;
}
.stat-card:hover {
  border-color: var(--border-hover);
  transform: translateY(-2px);
}
```

### Badge side (LONG/SHORT)

```css
.side-badge.long  { background: var(--green-dim); color: var(--green); }
.side-badge.short { background: var(--red-dim);   color: var(--red);   }
```

### Locked Feature (blocs premium)

```css
.locked-feature {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
}
.locked-preview {
  filter: blur(2px);
  opacity: 0.35;
  pointer-events: none;
}
.locked-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(8, 12, 20, 0.82);
  backdrop-filter: blur(6px);
}
```

### Navigation sidebar

```css
.nav-item.active {
  background: rgba(59, 130, 246, 0.12);
  color: var(--blue-bright);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 20px;
  background: var(--blue);
  border-radius: 0 3px 3px 0;
}
```

---

## Dimensions fixes

| Élément | Valeur |
|---|---|
| Topbar height | **77px** |
| Sidebar width | 240px |
| Border radius cards | 12px |
| Border radius boutons | 8px |
| Border radius badges | 4-6px |

---

## Dark mode — UNIQUEMENT

- Jamais de fond blanc
- Jamais de thème clair
- Background le plus sombre : `var(--bg)` = `#080c14`

---

## Icônes

- `lucide-angular` exclusivement dans l'app Angular
- Taille standard : 14-16px dans la sidebar, 16-20px dans le contenu
- Stroke width : 1.5-2px
- Jamais d'icônes emoji dans les composants Angular (sauf émotions trader)

---

## Animations

```css
/* Transitions standard */
transition: all .15s;          /* interactions rapides (hover) */
transition: all .2s;           /* états (active, focus) */
transition: transform .2s;     /* cartes au hover */

/* Pulse IA */
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .5; transform: scale(.8); }
}

/* Bounce (typing indicator) */
@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-5px); }
}
```
