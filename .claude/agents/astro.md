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
- **Hero + « Ta prop firm, en direct »** (`PropFirmLive.astro`, audit du 2026-10-06) : la home vise
  d'abord le prop trader futures (Tradovate / NinjaTrader). Le sélecteur firm → plan → phase lit le
  catalogue de l'app (`@mtc/shared` `PROP_FIRM_CATALOG_FILES`) réduit AU BUILD par
  `src/data/prop-firm-catalog.ts` (JSON compact embarqué, ~50 ko) ; les libellés viennent de
  `src/data/prop-firm-rules-view.ts` (pur, partagé rendu serveur / script). Ajouter une firm au
  catalogue suffit : la landing suit. Éléments recréés par le script → styles en `:global()`
  bornés à la section (sinon sans l'attribut de portée Astro, donc sans style). Nombre de firms du
  Hero = `PROP_FIRM_CATALOG_FILES.length`, jamais en dur (idem `Compare.astro` et `MultiComptes.astro`).
  Mise en page (2026-10-08) : carrousel `PropFirmMarquee.astro` sous le sous-titre (noms en wordmark,
  pas de logos ; clic = choix de la firm via `data-pf-pick`, géré par le script de PropFirmLive),
  sélecteur à gauche, **panneau de tuiles** à droite (objectif, drawdown + plancher figé, perte du jour,
  consistency, taille max, clôture en heure de Paris comme l'app, payout en funded), puis CTA, mention
  « Calcul indicatif : la plateforme de ta firm fait foi. » et captures en pleine largeur avec switch
  Évaluation / Funded : `showcase/app-prop-firm-rules.webp` (Apex 50K éval) et
  `showcase/app-prop-firm-funded.webp` (Tradeify 50K funded), dépli « Mes comptes » du compte démo (prod),
  barre latérale repliée, complet jusqu'à « Sources officielles ». Mobile : tuiles sur 2 colonnes, capture
  à 820 px défilable. Nav : menu hamburger jusqu'à 1023 px (les liens ne tiennent pas en tablette).
- **Structure de la home après l'audit du 2026-10-06** : Hero prop firm (+ ligne de confiance
  factuelle `.hero-trust`, ordonnée après les CTA en mobile), « Ta prop firm, en direct », timeline
  d'un prop trader (trade qui arrive seul, marge en direct, anti-tilt), **6 cartes** fonctionnalités
  hiérarchisées (suivi prop firm en tête ; récap 17h30 et score regroupés), Coach IA raccourci (bloc
  « 3 étapes » retiré). **Aucune affirmation d'exclusivité** (« le seul », « le premier ») : non
  défendable face aux concurrents (cf. `docs/veille-focuspips.md`).
- **Clics CTA → GA4** (`Analytics.astro`) : tout lien avec `data-ga-event` (`cta_signup`, `cta_demo`,
  `cta_trial`) et `data-ga-place` envoie un événement GA4, SEULEMENT si GA est chargé (après consentement).
  Nouveau CTA d'inscription → ajouter les deux attributs.
- **Tarifs (`Pricing.astro`)** : ce que Premium ajoute = UNE liste `premiumPlus` rendue deux fois,
  bloc « Ce que Premium ajoute au Gratuit » au-dessus des prix (entrées `key`, ancres réelles de
  `plans.md`) et carte Premium (« Tout le Gratuit, plus : »). Ajouter un droit Premium = une ligne
  dans `premiumPlus`. `#pricing` a `scroll-margin-top` = barre fixe (60 px) : le menu « Tarifs »
  arrive sur le titre, le bloc et les prix ensemble (retour de Val, 2026-10-06).

- **Offre fondateur (#525)** : état lu côté navigateur sur `GET {API_URL}/pricing/founder`
  (`src/lib/founder-offer.ts` : une requête par page, réponse `{ data }` déballée, état gardé 60 s en
  sessionStorage `mtc_founder`, validé ; API injoignable ou réponse invalide → rien).
  **État lu AU BUILD** (`src/lib/founder-build.ts`, `GET /pricing/founder` une fois par build,
  comme le compteur de traders) et passé en prop `founderOpen` à Hero, Pricing et FAQ :
  - **ouverte au build** → carte Fondateur (`#fondateur`), sa note et la question FAQ sont dans le
    HTML statique (enveloppe `.founder-slot` en `display: contents`, même balisage que le gabarit),
    `.has-founder` posé d'emblée, compteur de places à place réservée (`.founder-seats.is-pending`,
    `visibility: hidden` jusqu'au vrai chiffre) → l'arrivée de la réponse de l'API ne déplace rien.
    L'API ne fait plus que remplir le compteur, ou **retirer** carte, note, FAQ et tout
    `[data-founder-only]` (raccourci du Hero) si elle répond **explicitement** que l'offre ne vend
    plus. API injoignable ou réponse invalide (`null`) → tout reste affiché, compteur masqué : pas
    de saut de mise en page. Sûr parce que le serveur refuse le checkout fondateur si l'offre est
    fermée, échue ou complète (`FounderOfferService.eligibility` → 400 `closed` / `sold_out`, puis
    réservation sous verrou Postgres → 409 ; vérifié le 2026-10-16) ;
  - **fermée au build, ou API injoignable au build** → HTML « offre fermée » comme avant : bandeau,
    carte, note et FAQ dans des `<template>` (inertes, ni rendus ni indexés), insérés par le script
    seulement si l'offre vend → 2 cartes, Premium « Recommandé », aucun « 29 € » ni « fondateur »
    visible (commentaires en `{/* */}`, jamais `<!-- -->` qui part dans le HTML).
  - **⚠️ Ouverture ou fermeture de l'offre dans l'admin → relancer le déploiement de la landing**
    (Actions → CD, ou un push sur la landing) : sinon le HTML
    reste celui du build (offre ouverte au build puis fermée : la carte s'affiche puis est retirée à
    la réponse de l'API, et le « 29 € » reste dans le HTML indexé jusqu'au prochain build).
  Un lien inséré après coup reprend les paramètres (ref, promo, utm_*) du lien Premium. Le bandeau
  (fixe, zéro CLS) reste inséré par le script : rien n'apparaît tant que l'API ne dit pas `open` +
  places > 0 (cache HTTP de 60 s : jusqu'à 1 min de délai après l'ouverture dans l'admin).
  - Bandeau `FounderBanner.astro`, inclus par `Nav.astro` (toutes les pages) : fixe, 32 px, la Nav
    descend par `transform` (`html.has-offer-bar`) → **zéro CLS**. Élément collé sous la Nav sans
    marge → attribut `data-offer-shift` (bandeau « Fait en France » du Hero). Ancres :
    `scroll-padding-top: 92px` quand le bandeau est là. Fermeture mémorisée (sessionStorage
    `mtc_offer_bar_closed`).
  - `Pricing.astro` : carte Fondateur au centre (`.is-founder`), `.has-founder` sur la section
    → 3 colonnes, Premium perd sa mise en avant ; ≤ 1024 px empilées, Fondateur en premier, et dans
    la carte **prix, bouton, PUIS fonctionnalités** (`order` CSS). Même liste `premiumPlus` que la
    carte Premium (« Tout Premium inclus »). Prix : « ou 290 €/an · au lieu de 49 €/mois ».
  - **Arrivée depuis la pub** (`/?utm_…#pricing`, campagne Instagram du 2026-10) : en mobile
    (≤ 1024 px), offre ouverte au build, `#pricing` ou `#fondateur` → la page s'arrête sur la carte
    Fondateur (prix et bouton dans le 1er écran, sous la Nav et le bandeau), pas sur le titre de la
    section 2 écrans plus haut. Script inline juste après la carte (avant le 1er affichage) :
    recalage à chaque étape du chargement (DOMContentLoaded, polices, load, ResizeObserver, classe
    `has-offer-bar`, défilement non initié par le visiteur, car le navigateur refait son propre saut
    vers l'ancre en fin de chargement), pendant 10 s, arrêté au premier geste (toucher, molette,
    clavier). Carte affichée sans fondu (`.reveal.vis-now`). Bureau : inchangé. Mesure du
    2026-10-16 (Slow 4G, iPhone 390×844) : bouton cliquable à 1,7 s (1,9 à 2,2 s avec CPU ×4),
    445 px sous le haut de l'écran, au lieu de 1 900 px plus bas.
  - Hero, mobile seulement : raccourci « 🔥 Offre fondateur : 29 €/mois à vie » (`#fondateur`)
    juste après « Commencer gratuitement » (qui reste le premier), rendu si l'offre est ouverte au
    build (`data-founder-only`). Compact en ≤ 768 px (46 px de haut) et `.hero-founder` réduit la
    marge sous les puces (24 px au lieu de 40) : entièrement visible au-dessus du bandeau cookies en
    390×844 et 393×852 (pas en 375×812 ni 375×667, où il passe sous le bandeau). Pas de point de clic `hero` (absent de `OFFER_CTAS`) : la carte
    envoie `carte`.
  - Sous-titre des tarifs : le mois offert est rattaché au **Premium mensuel à 49 €** (l'offre
    fondateur n'a pas d'essai, cf. la note sous les cartes).
  - FAQ : `FOUNDER_FAQ` (variantes `open` / `ended`) affichée seulement si l'offre vend ou s'est
    clôturée (`ended`), **hors `FAQ` donc hors JSON-LD**. La question « code partenaire » est dans `FAQ`.
  - Point de clic `cta` : `carte` par défaut ; `bandeau` / `faq` retenus en sessionStorage `mtc_cta`
    et posés sur le lien de la carte au clic. **Jamais d'UTM sur un lien interne.**
    `?cta=email` (lien e-mail pointant sur la landing) est capté par `captureCtaFromUrl()` et retenu
    de la même façon ; aucune autre valeur n'est acceptée depuis l'URL. (La campagne `founder_launch`
    pointe, elle, directement dans l'app.)
  - `?promo=CODE` (script de `Base.astro`) : format `^[A-Z0-9_-]{3,20}$`, gardé 30 j en localStorage
    `mtc_promo` (comme `ref`), ajouté à tous les liens `/register`, à côté des UTM d'origine.
  - JSON-LD : prix NORMAL uniquement. CGU : clauses `#offre-fondateur` et `#codes-partenaires`.

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

- `Features.astro` (carte 02 « Synchro Tradovate & import CSV ») et `FAQ.astro` (« Puis-je importer
  mon historique ? ») présentent la **connexion Tradovate** comme voie principale, en lecture seule.
  **Depuis l'import d'historique par la Reporting API, tout l'historique remonte à la connexion**
  (`launchFullImport`, cf. nestjs.md « toute la vie du compte ») puis les trades + frais arrivent en
  direct. L'ancienne règle « le passé s'importe à part en CSV » est périmée (corrigée le 2026-10-06).
  L'import CSV couvre aussi les autres brokers.
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
- Mobile (< 768 px) : bandeau compact (~ 89 px au lieu de 138) — texte à gauche, Refuser et Accepter
  empilés à droite, mêmes dimensions. Il ne doit jamais couvrir le bouton de la carte Fondateur à
  l'arrivée depuis la pub.
- **Source d'acquisition** (script UTM de `Base.astro`) : `utm_*` du lien, sinon **site d'origine**
  (`document.referrer` externe → `utm_source=<hôte sans www>`, `utm_medium=referral`), gardée en
  sessionStorage `mtc_utm` et ajoutée à tous les liens `/register`. L'app applique le même plan B
  si on arrive directement sur `/register` (`referrerHost` de `register.component.ts`).
- **Compteur de visites sans cookie** : le même script envoie `POST {API_URL}/public/visit`
  (`path`, `source`, `medium`, `campaign`, `entry` = 1re page de la session, flag sessionStorage `mtc_visit`) sur chaque
  page, quel que soit le choix cookies (exemption CNIL : agrégé, anonyme). Résultat dans l'admin
  `/acquisition`. Si un hébergeur/CDN ajoute une CSP, autoriser `connect-src` vers l'API.
- **Navigateur intégré** (`inApp`) : motif `IN_APP_UA_PATTERN` de `@mtc/shared` (Instagram, FBAN/FBAV/
  FB_IAB/FBIOS, TikTok/musical_ly, Line/), passé au script inline par `define:vars` (un script inline
  n'importe rien). Seul le booléen part avec la visite, jamais le user-agent.
- **Parcours d'inscription** (`cta_click`) : même script, délégation de clic sur tout
  `a[href*="/register"]` (couvre la carte Fondateur insérée après coup) → `POST {API_URL}/public/funnel`
  par **`navigator.sendBeacon` en `text/plain`** (requête simple, sans requête préalable CORS, part
  même quand la page change ; l'API lit ce corps en JSON sur cette route seulement), repli `fetch`
  keepalive. `detail` = `data-cta` du lien (`founder` / `free` / `premium`, posé sur les 3 cartes de
  `Pricing.astro`), sinon `plan` du lien (`founder` / `premium`), sinon `free`. Nouveau CTA
  d'inscription : rien à faire s'il est gratuit ; poser `data-cta` si c'est une offre.
- **Mode interne** (visites de l'équipe) : ouvrir `https://www.mytradingcoach.app/?internal=1` →
  localStorage `mtc_internal=1` (`INTERNAL_STORAGE_KEY`) : plus aucune visite ni étape envoyée depuis ce
  navigateur, badge discret « interne » en bas à gauche (`.internal-badge`, `global.css`).
  `?internal=0` annule. Propre au domaine : l'app a le sien (`app.mytradingcoach.app/?internal=1`).
  GA4 n'est pas concerné (il dépend du consentement).
- Politique de confidentialité, section 6 : le paragraphe « Mesure d'audience sans cookie » décrit
  aussi les étapes de l'inscription et le booléen navigateur intégré. Toute nouvelle mesure → l'y ajouter.
- Nouveau traceur (pixel, Hotjar…) = même règle : chargé par `Analytics.astro` après consentement,
  et déclaré dans la politique de confidentialité.

---

## Tableau comparatif (`Compare.astro`)

Les lignes sont **une seule source de vérité** (tableau `rows` dans le frontmatter) : le rendu
desktop (MTC Gratuit + MTC Premium + 3 concurrents) et le rendu mobile (Gratuit, Premium, « Les
autres ») en sortent tous les deux, ils ne peuvent pas diverger.

- Ajouter une ligne = un objet dans `rows` : `free` / `premium` (MTC) + `rivals: [FocusPips, TradesViz, Edgely]`.
- MTC est coupé en **deux colonnes Gratuit / Premium**, alignées sur le contrôle d'accès réel de
  l'API (guards, crons, `AccountsService`) — pas de badge « PREMIUM » à côté d'une coche.
- Concurrents : `false` = non mentionné sur le site officiel · `yes('Pro')` = palier minimum où la
  fonction apparaît · `yes()` = proposé, palier non précisé · `txt('…')` = valeur nuancée.
  **Uniquement des pages officielles**, sources listées en commentaire en tête du fichier ; dans le
  doute, trancher en faveur du concurrent (publicité comparative objective et vérifiable).
  Re-vérifier à chaque modification et mettre à jour `UPDATED`.
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
