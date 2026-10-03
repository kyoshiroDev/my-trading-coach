---
name: astro
description: "Conventions de la landing Astro (structure, blog en collection, JSON-LD, prix et liens partagés, conformité NinjaTrader). À lire avant tout travail dans apps/landing-mytradingcoach."
---

# Agent Astro — landing-mytradingcoach

## Stack
Astro 7 · CSS propre aux composants (Tailwind installé mais **inutilisé** : à retirer dès que le
réseau permet de régénérer le lockfile) · Static output · servi sur le VPS (conteneur nginx:alpine derrière Traefik,
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
├── config.ts                    ← APP_URL, API_URL, FEATURES (flags de publication)
├── data/
│   ├── faq.ts                   ← FAQ de la home : texte affiché ET JSON-LD FAQPage
│   └── schema.ts                ← JSON-LD (home : SoftwareApplication + FAQPage ; autres : Organization + WebSite)
├── content/blog/<slug>.md       ← UN fichier par article (le slug = nom du fichier)
├── content.config.ts            ← schéma du frontmatter blog
├── pages/
│   ├── index.astro              ← home
│   ├── blog/index.astro         ← liste générée depuis la collection (tri par publishDate)
│   ├── blog/[slug].astro        ← rendu d'un article
│   └── cgu, mentions-legales, politique-confidentialite, disclaimer, 404, ambassadeur…
├── components/                  ← sections de la home + mockup/ (maquettes produit de Showcase)
├── layouts/Base.astro           ← meta SEO, JSON-LD, fontes · BlogPost.astro ← gabarit article
└── styles/global.css, legal.css ← variables, utilitaires (.wrap), pages légales (.legal)
```

## Règles de contenu (audit du 27/09/2026)

- **Prix** : toujours `PREMIUM_PRICE_EUR` / `PREMIUM_ANNUAL_SAVINGS_EUR` de `@mtc/shared` (alias dans
  `tsconfig.json`), jamais un nombre en dur : Hero, Pricing, Compare, CGU, FAQ et JSON-LD en dépendent.
- **Liens vers l'app** : `${APP_URL}/register` (jamais `https://app.mytradingcoach.app` en dur) ;
  dans un article Markdown, écrire `href="{APP_URL}/register"` (remplacé au rendu par `[slug].astro`).
- **JSON-LD** : jamais d'`aggregateRating` sans avis vérifiables (règles Google + pratiques
  commerciales trompeuses). FAQ modifiée = `src/data/faq.ts` uniquement (affichage + JSON-LD suivent).
- **Nouvel article** : créer `src/content/blog/<slug>.md` avec le frontmatter ci-dessous. Rien d'autre :
  la page, la liste du blog et le sitemap (lastmod = updatedDate ?? publishDate) suivent.
- **Styles** : pas de `style="…"` ; classes dans le `<style>` du composant (scopé) ou utilitaire global
  (`.wrap` = conteneur 1100 px). Exception tolérée : valeurs uniques de dessin dans `components/mockup/`
  (positions, largeurs de barres). Survol : `:hover` en CSS, jamais `onmouseover`.
- Aucun composant orphelin : un composant non rendu est branché ou supprimé.

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

## Cookies & GA4 (consentement RGPD, oct. 2026)

- `PUBLIC_GA_ID` (build, variable de dépôt GitHub `PUBLIC_GA_ID` en prod, `PUBLIC_GA_ID_DEV` en dev).
  **Vide → ni bandeau, ni GA4, ni lien « Gérer les cookies »**, et la politique de confidentialité
  (section 6 + Google dans les destinataires) affiche la version « aucun traceur » : tout suit `GA_ID`
  (`config.ts`).
- `CookieConsent.astro` recueille le choix (localStorage `mtc_cookie_consent` = `{ value, ts }`,
  redemandé après 6 mois, `src/lib/consent.ts`) et émet `mtc:consent`. `Analytics.astro` est le
  **seul** endroit qui charge GA4 : injection dynamique de `gtag/js` après « accepted ». Jamais de
  balise GA statique dans le `<head>`.
- Refuser = même taille et même poids que Accepter (CNIL). Retrait après acceptation : cookies
  `_ga*` effacés + rechargement.
- **Source d'acquisition** (script UTM de `Base.astro`) : `utm_*` du lien, sinon **site d'origine**
  (`document.referrer` externe → `utm_source=<hôte sans www>`, `utm_medium=referral`), gardée en
  sessionStorage `mtc_utm` et ajoutée à tous les liens `/register`. L'app applique le même plan B
  si on arrive directement sur `/register` (`referrerHost` de `register.component.ts`).
- **Compteur de visites sans cookie** : le même script envoie `POST {API_URL}/public/visit`
  (`path`, `source`, `medium`, `campaign`, `entry` = 1re page de la session, flag sessionStorage `mtc_visit`) sur chaque
  page, quel que soit le choix cookies (exemption CNIL : agrégé, anonyme). Résultat dans l'admin
  `/acquisition`. Si un hébergeur/CDN ajoute une CSP, autoriser `connect-src` vers l'API.
- Nouveau traceur (pixel, Hotjar…) = même règle : chargé par `Analytics.astro` après consentement,
  et déclaré dans la politique de confidentialité.

---

## Tableau comparatif (`Compare.astro`)

Les 13 lignes sont **une seule source de vérité** (tableau `rows` dans le frontmatter) : le rendu
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
title: "Titre affiché avec mot-clé principal"
seoTitle: "Titre de l'onglet / Google (optionnel)"
description: "Description 155 caractères max avec mot-clé"
publishDate: 2026-04-01
updatedDate: 2026-05-01   # optionnel, alimente lastmod du sitemap
tags: ["trading", "journal", "psychologie"]
---
```

Le corps peut être du Markdown ou du HTML (les articles migrés gardent leur HTML d'origine).

CTA en fin de chaque article :
```markdown
<a href="{APP_URL}/register">Commencer gratuitement</a>
```

---

## Articles blog SEO cibles

| Fichier (`src/content/blog/`) | Mot-clé principal |
|---|---|
| `journal-trading-debutant.md` | journal de trading débutant |
| `psychologie-trading.md` | psychologie trading biais cognitifs |
| `revenge-trading.md` | revenge trading (faible concurrence) |
| `win-rate-trading.md` | win rate trading calculer |
| `journal-trading-crypto.md` | journal trading crypto 2026 |

---

## Package.json landing

Voir `apps/landing-mytradingcoach/package.json`. À faire quand le réseau le permet (lockfile) :
retirer `tailwindcss` et `@tailwindcss/vite`, aligner TypeScript sur la racine (6.x), ajouter
`eslint-plugin-astro` + `prettier-plugin-astro` (cible `lint` = eslint + `astro check`), et
auto-héberger les fontes (`@fontsource/*`, fin du hack `media="print" onload`).

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
- **Chiffres de performance** (P&L, WR) dans une narration ou une capture : toujours accompagnés de
  « exemple illustratif » / « données d'exemple » (`.day-illus` dans DayTimeline,
  `.showcase-note` dans Showcase). Pas de promesse de progression (« tu seras meilleur »).
- **Showcase = vraies captures, jamais de maquette** : `public/showcase/app-dashboard.webp` et
  `app-ai.webp`, prises sur le compte démo DEV (`https://dev.app.mytradingcoach.app/demo`, Lucas
  Mercier). Les anciens mockups (`components/mockup/`, données inventées) ont été supprimés : ils
  dérivaient à chaque refonte de l'app. **Rafraîchir** après une refonte visible de ces écrans :
  - Dashboard : viewport **1680×1000**, DPR 1.5, rogner le bandeau « Mode démo » (44 px en haut).
    À 1440 px, les sparklines des cartes KPI chevauchent les montants (bug app) : ne pas descendre.
  - IA Insights : 1440×900, DPR 2, rogné sur le contenu (sans l'en-tête, dont le bouton affiche
    « Disponible dans 3h 60min », bug d'arrondi de l'app).
  - PNG → WebP qualité 82 (`convert x.png -quality 82 -define webp:method=6 x.webp`, ~90-110 Ko),
    puis mettre à jour `width`/`height` des `<img>` (zéro CLS).
  - Journal et Analytics écartés (sept. 2026) : pourcentages P&L forex aberrants sur les EUR/USD du
    seed démo (+2764 %), graphiques Analytics vides sur la période par défaut.
- **Ordre de la home** : Hero → **Showcase** → Moments → DayTimeline → Features → … `Problem.astro`
  n'est plus rendu (il redisait Moments). `CoachIA` et `Debrief` restent non rendus.
- **Compare** : le prix MTC affiche **les deux paliers** « 0 € (Gratuit) · dès 49 € (Premium) ».
  Jamais le Premium seul (MTC paraît le plus cher), jamais « dès 0 € » seul (laisse croire que
  toutes les coches MTC, dont Coach IA / Weekly Debrief / recap 17h30, sont gratuites). En mobile,
  un palier par ligne, sans le « · » (`.comp-price-part` / `.comp-price-sep`).
- **Barre sticky mobile** (`Nav.astro`, `.nav-sticky-cta`) : masquée quand `.hero-cta-main` est à
  l'écran (IntersectionObserver), quand le menu est ouvert (`body.nav-open`), et absente des pages
  qui passent `<Nav stickyCta={false} />` (`/disclaimer`).
