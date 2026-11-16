# Courbes d'équité et de drawdown

> Contenu déplacé à l'identique depuis `.claude/agents/design.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : design.md · Courbes d'équité et de drawdown (`mtc-perf-chart`) · 2026-10-19 -->
> **Origine** : `design.md` · « Courbes d'équité et de drawdown (`mtc-perf-chart`) » · 2026-10-19

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
  Courbe par trade : infobulle au centime (valeur, « Trade ±$x,xx », « Payout ») ; courbes journalières au dollar.
- **Animation** : découverte gauche → droite 380 ms quand les données changent, aucune si
  `prefers-reduced-motion` ou simple redimensionnement.
- **Accessibilité** : canvas `role="img"` + `aria-label` (départ, actuel, max pour le drawdown, période).
