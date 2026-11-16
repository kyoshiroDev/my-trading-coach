---
name: design
description: "À appeler pour vérifier un diff qui change une interface (templates, CSS) de l'app, de l'admin ou de la landing : couleurs, typographie, composants, icônes, accessibilité."
tools: Read, Grep, Glob, Bash
---

# Agent Design — Système visuel MyTradingCoach · « The Terminal »

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- apps/app-mytradingcoach apps/admin-mytradingcoach apps/landing-mytradingcoach libs/front/ui`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Dark only : jamais de thème clair, jamais `#000` / `#fff` (seule exception validée : panneau du paiement, #525).
2. Tokens « The Terminal Palette » seulement, aucune couleur en dur.
3. Bleu = signal (CTA, interactif) ; vert = gains, rouge = pertes, jamais inversé ni décoratif.
4. Valeurs numériques en `var(--font-mono)` avec chiffres tabulaires.
5. Espace insécable avant `:` `;` `!` `?` et `%`.
6. Icônes Lucide, jamais d'emoji (sauf émotions trader).
7. Pages en pleine largeur à droite de la sidebar ; dimensions fixes respectées (`reference/design/dimensions.md`).
8. Composant existant réutilisé (KPI, panel, badge, bloc verrouillé, filtres, info-bulle) plutôt qu'un nouveau style (`reference/design/composants-base.md`).
9. Admin : design de `admin-mytradingcoach.html` ; app : composant + maquette dédiée.
10. Accessibilité : boutons avec un nom, focus visible, contrastes.

Réponse, toujours ce format, court :
```
Domaine : design
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

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
- Polices : **Space Grotesk** (display), **Inter** (body), **JetBrains Mono** (mono), auto-hébergées
  (`@fontsource`) et déclarées dans `src/styles/fonts.css` (GÉNÉRÉ par `tools/scripts/generate-font-faces.mjs`,
  sous-ensembles latin + latin-ext : é, œ, €, ·, « », ’ compris). Nouvelle graisse : l'ajouter au
  script, le relancer ; `fonts.spec.ts` vérifie chaque famille et graisse. Une police ou une graisse
  ajoutée alourdit le CSS initial : budget du bundle (plafond 500 ko) avec marge cible 20 ko, alerte sous 10 ko : au-dessous, on s'arrête et on ouvre une PR budget (`angular.md`).
- Ton produit : français, tutoiement, direct et concret (nommer le vrai problème, chiffres réels).
- **Typographie** : espace insécable (`&nbsp;` dans les gabarits) avant `:` `;` `!` `?` et `%`. Vérifié
  sur Parrainage, Ambassadeur et Devenir ambassadeur par `src/app/typographie-parrainage.spec.ts`.
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
>
> Intensité d'activité (pastilles de streak de Score) : `--streak-0` (aucune) à `--streak-4`
> (`--green`), appliquées par la classe `niveau-N`, jamais en style lié. Vérifié par
> `features/scoring/score-streak-couleurs.spec.ts`.
>
> **Carte « Streak & activité » de Score : activité RÉELLE** depuis le 25/10/2026 (`features/scoring/streak.ts`,
> données de `GET /analytics/activity/range`, journées Paris, tous comptes actifs) : 35 derniers jours
> OUVRÉS (week-ends absents), intensité = trades du jour 0 · 1 · 2-3 · 4-5 · 6+ → niveaux 0 à 4, série =
> jours ouvrés consécutifs avec trade (week-end et journée en cours ne la cassent pas), comptée sur ~1 an.
> Seule dans sa colonne, hauteur naturelle (`.right-col .streak-card`). Specs : `streak.spec.ts`,
> `scoring-streak.spec.ts` (rendu, compte normal et démo).
> **Carte « Badges obtenus » MASQUÉE** (`BADGES_VISIBLES = false`) : badges encore statiques ; ne la
> réafficher qu'avec des règles d'obtention réelles (ticket à part).

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
- **Titres** : icône Lucide à la place de l'emoji. h1 de page : 20 px, `--text-2`, calée sur la
  PREMIÈRE ligne (`align-self: flex-start; margin-top: calc((1lh - 20px) / 2)`), sinon elle tombe
  entre deux lignes quand le titre passe à la ligne. Titre de carte : 16 px, `--text-3`.
  `src/app/titles-no-emoji.spec.ts` balaie les gabarits (h1-h6, classes title/label/lbl/head,
  `<mtc-topbar title>`) : plus AUCUN emoji de titre depuis le 25/10/2026 (`RESTANTS` vide), un ajout
  fait échouer le test. Icône en ligne dans un titre non flex : `vertical-align: -0.2em` (sur la ligne
  de base, elle monte de 3 px). Un en-tête de modale reprend l'icône du bouton qui l'ouvre.
- **Icônes de l'app installée (PWA)** : `apps/app-mytradingcoach/public/pwa/`, générées depuis le
  tracé de `logo.svg` par `tools/scripts/generate-app-icons.mjs` (dégradé `--blue` → `--purple`,
  courbe `--text`, lus dans `theme.css`). Jamais retouchées à la main : modifier le script et relancer.
- **Feuille d'installation** (`features/install/`, maquette `mockup-installation-pwa.html`) : feuille en
  bas d'écran sur mobile (iPhone : flottante au-dessus de la barre de Safari, flèche vers Partager),
  boîte centrée de 440 px à partir de 768 px (une feuille n'est pas une page : son plafond est permis).
  Variables de `theme.css` uniquement, sauf le blanc des boutons `--primary` ; écran verrouillé en
  `--bg-3` → `--bg-2`, icône d'appli en `--grad-brand`, exemple d'alerte bordé `--yellow`. Boutons 44 px
  au moins. Ligne « Installer l'app » du Profil : toute la largeur, comme la section Notifications
  (mesuré de 360 à 2560 px, aucun défilement horizontal). Vérifié par `install.styles.spec.ts`.

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

---

## Détail déplacé (résumé)

- **Composants** : non-négociables et patterns (`reference/design/composants-base.md`), graphiques, inscription, séance.

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `design/composants-base.md` | KPI, panel, badge, bloc verrouillé, filtres, info-bulle, sidebar |
| `design/dimensions.md` | dimensions fixes (sidebar, topbar, cartes) |
| `design/graphiques.md` | courbes d'équité et de drawdown |
| `design/inscription.md` | `/register`, `/login` |
| `design/session.md` | Ma session, session live |
