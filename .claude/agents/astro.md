# Agent Astro — landing-mytradingcoach

## Stack
Astro 7 · Tailwind 4 · Static output · servi sur le VPS (conteneur nginx:alpine derrière Traefik,
rsync depuis GitHub Actions vers `/opt/static/landing-prod`). Plus de Vercel.

---

## Règles absolues

- `output: 'static'` — HTML pur, zéro JS client par défaut
- Le miroir `landing-mytradingcoach.html` a été retiré du dépôt (commit `581875e`) : la source de
  vérité design est le composant `.astro` lui-même, plus les `maquette-*.html` du dossier
  `maquettes/` (gitignoré, local)
- Ne pas inventer de sections, couleurs ou composants

---

## Structure

```
src/
├── pages/
│   ├── index.astro              ← landing principale
│   ├── mentions-legales.astro
│   ├── confidentialite.astro
│   └── cgu.astro
├── content/
│   └── blog/                   ← articles Markdown SEO
│       ├── journal-trading-debutant.md
│       ├── psychologie-trading.md
│       ├── revenge-trading.md
│       ├── win-rate-trading.md
│       └── journal-trading-crypto.md
├── components/
│   ├── Hero.astro
│   ├── Features.astro
│   ├── Pricing.astro
│   ├── FAQ.astro
│   ├── Testimonials.astro
│   └── Footer.astro
└── layouts/
    └── Layout.astro             ← meta SEO, fonts, analytics
```

---

## Compliance NinjaTrader Ecosystem (PROMPT-201)

MyTradingCoach est référencé dans l'écosystème NinjaTrader, ce qui impose 4 avertissements
au texte **non modifiable** (source : `Ninja Trader/3. Disclaimers_VF.docx`, hors dépôt) :

| Avertissement | Où |
|---|---|
| Risques · Performances hypothétiques · Live Trade Room · Témoignages | `src/pages/disclaimer.astro`, section 7 |

Règles :
- **Ne jamais paraphraser, résumer ni tronquer** ces 4 textes — ce sont des mentions réglementaires
  imposées. Toute retouche doit repartir de la `.docx`.
- Le `footer` doit conserver les mentions clés (risque de perte, performances passées,
  résultats hypothétiques) + le lien vers `/disclaimer`.

### Wordmark NinjaTrader

- Assets : `public/ninjatrader/` — wordmark `NinjaTrader_Wordmark_color_RGB.png` (2376×300, `#FF4200`
  sur transparent) + 5 bannières publicitaires (`ninjatrader-banner-*.png`).
- Affiché dans `Footer.astro` (`.footer-eco`) : **ligne dédiée centrée** sous la barre légale,
  hauteur **18 px** (`width:auto`, `aspect-ratio:2376/300` pour zéro CLS, `object-fit:contain`).
  **Ne pas recolorer, déformer ni rogner** — le seul levier de discrétion est la taille : le
  orange `#FF4200` domine tout le footer dès qu'on dépasse ~20 px, et doit rester secondaire
  devant la marque « MyTradingCoach » (22 px).
- Les bannières ne sont **pas utilisées** : ce sont des créatives publicitaires avec CTA « Learn More »,
  elles supposent un lien d'affiliation actif.
- Le wordmark est un **lien d'affiliation** (PROMPT-204) : `NINJATRADER_AFFILIATE_URL` dans
  `Footer.astro`, `rel="noopener sponsored nofollow"` + `target="_blank"`. L'ID vendeur `7724604`
  est dans l'URL — la modifier casse le tracking.
- **Lien affilié = divulgation obligatoire**, aux deux endroits : mention « Lien affilié » à côté du
  logo *et* paragraphe « Divulgation d'affiliation » en section 7 de `disclaimer.astro`. Ne jamais
  retirer l'un sans l'autre, ni le lien sans les deux.

### Annonce de la synchro Tradovate (PROMPT-211)

- `Features.astro` (carte 07 « Synchro Tradovate & import CSV ») et `FAQ.astro` (« Puis-je importer
  mon historique ? ») présentent la **connexion Tradovate** comme voie principale : **dès la
  connexion, les nouveaux trades + frais remontent en direct**, en lecture seule. Ne jamais écrire
  que la synchro « rattrape » l'historique : le passé s'importe à part (export CSV Tradovate).
  L'import CSV couvre aussi les autres brokers (audit UX 2026-09-27).
- **Formulation factuelle uniquement (clause 17)** : jamais « Partenaire officiel de NinjaTrader »,
  « Recommandé / Approuvé par NinjaTrader » ni aucune caution. Le logo NinjaTrader reste **au seul
  footer**. Aucune promesse de gain (AMF) : on décrit ce que fait la synchro, pas un résultat.
- `Compare.astro` **inchangé volontairement** : TraderSync et TradesViz proposent une synchro
  broker ; une ligne « Synchro broker directe » les montrerait à tort sans (cf. règle ci-dessous).

---

## Tableau comparatif (`Compare.astro`)

Les 12 lignes sont **une seule source de vérité** (tableau `rows` dans le frontmatter) : le rendu
desktop 5 colonnes et le rendu mobile 2 colonnes en sortent tous les deux, ils ne peuvent pas diverger.

- Ajouter une ligne = un objet dans `rows` (`mtc` + `rivals: [TraderSync, TradesViz, Edgely]`).
- La colonne mobile « Les autres » est **calculée** par `merge()`, jamais saisie à la main :
  `✓` seulement si les trois concurrents l'ont · `-` seulement si aucun ne l'a · `partiel` dès que
  c'est mixte. **Ne jamais afficher `-` quand un concurrent propose la fonctionnalité** — ce serait
  une affirmation fausse.
- Valeurs non booléennes (prix) : renseigner `othersLabel` avec une fourchette couvrant les trois.
- Bascule purement CSS : `.c-rival` (masqué < 768px) / `.c-others` (masqué ≥ 768px). Pas de
  `min-width` en mobile — le tableau doit tenir dans le viewport sans scroll horizontal.

---

## Pricing — limites IA à afficher

Dans la section pricing PREMIUM, mentionner les limites de façon positive :

```
✨ IA Insights (1 analyse toutes les 4h)
💬 Chat Coach IA (jusqu'à 50 messages/jour)
📅 Weekly Debrief automatique chaque dimanche
```

Formulation : jamais "limité à", toujours "jusqu'à" ou entre parenthèses en petit.

---

## SEO — Frontmatter blog obligatoire

```markdown
---
title: "Titre avec mot-clé principal"
description: "Description 155 caractères max avec mot-clé"
publishDate: 2026-04-01
tags: ["trading", "journal", "psychologie"]
draft: false
---
```

CTA en fin de chaque article :
```markdown
**Essaie MyTradingCoach gratuitement →** [Commencer maintenant](https://app.mytradingcoach.app/register)
```

---

## Articles blog SEO cibles

| Fichier | Mot-clé principal |
|---|---|
| `journal-trading-debutant.md` | journal de trading débutant |
| `psychologie-trading.md` | psychologie trading biais cognitifs |
| `revenge-trading.md` | revenge trading (faible concurrence) |
| `win-rate-trading.md` | win rate trading calculer |
| `journal-trading-crypto.md` | journal trading crypto 2026 |

---

## Package.json landing

```json
{
  "dependencies": {
    "@astrojs/sitemap": "^3.7.4",
    "astro": "^7.3.2",
    "tailwindcss": "^4.3.3"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.10",
    "@tailwindcss/vite": "^4.3.3",
    "typescript": "^5.9.2"
  }
}
```

---

## Checklist SEO avant deploy

- [ ] `<title>` unique sur chaque page
- [ ] `<meta name="description">` présente (155 car. max)
- [ ] `<link rel="canonical">` sur chaque page
- [ ] `robots.txt` présent dans `public/`
- [ ] `sitemap-index.xml` généré par `@astrojs/sitemap`
- [ ] Pas de `noindex` / `nofollow` accidentel
- [ ] LCP < 1.2s
- [ ] CLS < 0.05
- [ ] Images avec `alt` renseigné

## Astro 7 (étape 5 de l'audit, 2026-09-13)

- Astro 7.3.2 · Vite 8 · compilateur Rust (seul compilateur). Tailwind 4.3.3 (`@tailwindcss/vite`
  accepte Vite 8), `@astrojs/check` 0.9.10. Motif : faille critique d'Astro 6 (exécution de code via
  l'optimisation d'images AVIF), corrigée seulement à partir de 7.2.8.
- `compressHTML: true` posé explicitement dans `astro.config.mjs` : le défaut d'Astro 7 (`'jsx'`)
  supprime des espaces entre éléments en ligne. Ne pas le retirer sans revérifier le rendu.
- `z` s'importe de `astro/zod` (celui d'`astro:content` est déprécié).
- Le compilateur Rust ne corrige plus une imbrication HTML invalide et refuse une balise non
  fermée : un build qui casse après une modif de template vient souvent de là.
- Vérification de la migration : HTML des 21 pages comparé à Astro 6 (seuls 78 espacements entre
  blocs diffèrent, aucun texte ni structure) ; mise en page mesurée élément par élément dans le
  navigateur (accueil, un article, /ambassadeur ; bureau 2 398 px et mobile 400 px) : identique.
  La CSS générée change de forme (identifiants `data-astro-cid-*`, media queries en syntaxe
  d'intervalle `(width>=1200px)`), sans effet sur le rendu.

## Règles issues de l'audit UX (2026-09-27)

- **URLs de l'app** : jamais `https://app.mytradingcoach.app/...` en dur dans un `.astro`, toujours
  `` href={`${APP_URL}/register`} `` (`src/config.ts`). Sinon la landing DEV inscrit en prod.
  Seuls les `.md` de `content/blog/` gardent l'URL prod en dur (pas d'import possible).
- **Compteur de traders** : n'affiche **aucun chiffre** sous `TRADERS_PUBLIC_THRESHOLD` (100,
  `config.ts`). Hero : bloc `.hero-proof` non rendu. Testimonials : titre « Construit avec les
  premiers traders » sans chiffre. Le script live de `index.astro` retire `[data-traders-proof]`
  si l'API repasse sous le seuil. Côté API, la clé Redis est suffixée par l'hôte de `FRONTEND_URL`
  (dev et prod partagent Redis db0).
- **Chiffres de performance** (P&L, WR) dans une narration ou un mockup : toujours accompagnés de
  « exemple illustratif » / « données fictives » (`.day-illus` dans DayTimeline,
  `.showcase-note` dans Showcase). Pas de promesse de progression (« tu seras meilleur »).
- **Ordre de la home** : Hero → **Showcase** → Moments → DayTimeline → Features → … `Problem.astro`
  n'est plus rendu (il redisait Moments). `CoachIA` et `Debrief` restent non rendus.
- **Compare** : le prix MTC affiche **les deux paliers** « 0 € (Gratuit) · dès 49 € (Premium) ».
  Jamais le Premium seul (MTC paraît le plus cher), jamais « dès 0 € » seul (laisse croire que
  toutes les coches MTC, dont Coach IA / Weekly Debrief / recap 17h30, sont gratuites). En mobile,
  un palier par ligne, sans le « · » (`.comp-price-part` / `.comp-price-sep`).
- **Barre sticky mobile** (`Nav.astro`, `.nav-sticky-cta`) : masquée quand `.hero-cta-main` est à
  l'écran (IntersectionObserver), quand le menu est ouvert (`body.nav-open`), et absente des pages
  qui passent `<Nav stickyCta={false} />` (`/disclaimer`).
