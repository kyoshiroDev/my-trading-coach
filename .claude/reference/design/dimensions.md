# Dimensions fixes

> Contenu déplacé à l'identique depuis `.claude/agents/design.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : design.md · Dimensions fixes · 2026-04-25 -->
> **Origine** : `design.md` · « Dimensions fixes » · 2026-04-25

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

**Rangées de boutons (#967)** : une rangée de boutons en `white-space: nowrap` avec `flex-shrink: 0`
déborde de sa carte sur téléphone (cas de « Fais ton premier pas » : 3 boutons sur une ligne, le 3e
invisible à 360-414 px, coupé jusqu'à ~880 px avec le menu latéral). Règle : `flex-wrap: wrap` +
`max-width: 100%` sur la rangée, et en `≤ 768 px` boutons empilés pleine largeur
(`flex-direction: column; align-items: stretch`, `white-space: normal`, `text-align: center`).
Vérifier à 360 px que `document.scrollWidth <= innerWidth` ET qu'aucun bouton ne dépasse la carte
(un conteneur parent en `overflow: hidden` masque le débordement sans créer de défilement).

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
