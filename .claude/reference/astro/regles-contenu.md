# Règles de contenu de la landing

> Contenu déplacé à l'identique depuis `.claude/agents/astro.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : astro.md · Règles de contenu (audit du 27/09/2026) · 2026-09-27 -->
> **Origine** : `astro.md` · « Règles de contenu (audit du 27/09/2026) » · 2026-09-27

## Règles de contenu (audit du 27/09/2026)

- **Vocabulaire du drawdown** (#937) : `DRAWDOWN_LABELS` de `@mtc/shared` (même source que l'app).
  Taille de la règle = `DRAWDOWN_LABELS.rule.label` (« Règle de drawdown », fiche des règles
  `prop-firm-rules-view.ts`), jamais « Drawdown max » ; marge = « marge avant le plancher », jamais
  « avant (le) drawdown » ni « il te reste » (réservé à l'objectif, contexte-com.md). Verrouillé par
  `libs/shared/src/drawdown-labels.spec.ts` (la landing n'a pas de suite de tests). « Drawdown max »
  reste correct pour une baisse mesurée (blog). La capture `app-prop-firm-rules-mobile.webp` montre
  encore l'ancien libellé : à recapturer avec son `alt`.
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
- **« L'app en vrai »** (`DemoVideo.astro`, 2026-11-09) : visite filmée de l'app (compte démo, données
  fictives) sur l'accueil (`accueil.astro` tant que `/` redirige ; à garder dans `index.astro` au retrait)
  après `<Compatible />`, et sur `/prop-firm` après « Compatible avec » (`<DemoVideo wide />` : 1200 px,
  marge mobile 20 px), ancre `#visite`. Pas de fond propre à la section (une bande `--bg2` jurait avec la
  page, retirée à la demande de Greg) et **lecteur nu** : la vidéo seule, bordure neutre 3 px `--b2` avec
  retrait transparent de 6 px (`.dv-screen` > `.dv-media` qui porte l'aspect-ratio et ses coins),
  ni cadre de navigateur, ni coque de téléphone, ni halo, ni ombre (Greg, 09/11). Deux vidéos dans `public/demo/` (rien d'autre dans ce dossier) :
  `visite-app-desktop.mp4` (1920×1200, ~1 min) + `visite-app-desktop-poster.webp`, et `visite-app.mp4`
  (592×1280 : export 720×1280 recadré `crop=592:1280:64:0` pour ôter les bandes de fond, ~1 min) + `visite-app-poster.webp` ; aperçus = 1re image (tableau de bord). Titre « en un
  peu plus d'une minute » (63 s ordinateur, 71 s mobile) : à revoir si la durée change. Pause du
  visiteur respectée : `userPaused` par vidéo (événement `pause` hors pauses du script, posées via
  `halt()`), le défilement ne relance pas ; remis à zéro à la bascule et au clic lecture.
  - **Mode** décidé en CSS (`data-mode` sur la section + media query 980 px) : ≥ 980 px, ORDINATEUR par
    défaut (texte centré au-dessus, vidéo jusqu'à `min(1280px, 100vw - 48px)`, il déborde
    le `.wrap` exprès : à 1100 px le texte de l'app tombe vers 7 px) et sélecteur « Ordinateur | Mobile »
    (`<button aria-pressed>`, puces de PropFirmLive, `demo_video_toggle` + `data-ga-place`) ; < 980 px,
    MOBILE seul (vidéo 360 px), sélecteur masqué. Choix non mémorisé. Hauteurs réservées par
    `aspect-ratio` 1920/1200 et 592/1280.
  - **Chargement** (LCP intact) : `<video preload="none">` sans `src`, source en `data-src`. Le script pose
    la source de la SEULE vidéo affichée quand la section approche (IntersectionObserver 200 px) ; l'autre
    seulement à la bascule. ≥ 980 px sans `prefers-reduced-motion` : lecture auto muette en boucle, pause
    hors écran (seuil 25 %), à la bascule l'ancienne est mise en pause et remise à 0. < 980 px ou animations
    réduites : aperçu + bouton lecture (`demo_video_play`), chargement au clic. `play()` refusé → bouton.
    Dès la lecture, barre de lecture native (`controls`) : avancer, reculer, pause. Aperçus en
    `<img loading="lazy">` (pas d'attribut `poster`, qui se télécharge dès le chargement).
  - **Encodage** (exports « -landing » : AUCUNE incrustation, la légende de la section porte la mention) :
    `ffmpeg -i <source> -an -c:v libx264 -preset veryslow -profile:v high -pix_fmt yuv420p -r 24 -crf 28
    -movflags +faststart -vf scale=1920:1200 visite-app-desktop.mp4` (720:1280 pour `visite-app.mp4`) ;
    aperçus `ffmpeg -ss 0.5 -i <source> -frames:v 1 -c:v libwebp -quality 78 <nom>-poster.webp`. Budget :
    < 4 Mo ordinateur, < 3 Mo mobile.
  - **Refaire les captures** (scripts hors dépôt : `~/Bureau/videos-instagram/_scripts-visite-13/`) :
    1. Banc local (mémoire « captures banc local ») : base dédiée, API compilée sur 3001 et app sur 4200
       depuis un worktree à jour, `pnpm run seed:demo` SANS `FMP_API_KEY` (faux vendredi NFP + analyse).
       Enregistrer en semaine, marché ouvert (00:40–23:00 Paris) : la séance du jour est vivante.
    2. `all.sh` : `take.sh desktop|mobile` (re-seed puis `tour13.mjs` : ordinateur 1440×900 DPR 2,
       mobile 390×844 DPR 2), `build13.sh` (titres de `labels2.mjs`, `post3.py` : exports
       `13-visite-complete-<format>-{landing,titre}.mp4`, ordinateur ramené à 1920×1200), encodage ci-dessus,
       planches-contact une image / 2 s (`sheet.py`).
    3. Parcours : tableau de bord, pré-session, séance en direct, débrief du jour, journal (semaine
       précédente dépliée sur ordinateur), historique (mois précédent), Mes comptes, Statistiques sur le
       compte Apex en évaluation, débrief hebdo, calendrier (filtre « Fort », vendredi précédent, analyse
       NFP dépliée), profil. Masques de `lib-rec2.mjs` : uniquement le hors-sujet (badge interne, bandeau
       démo, noms de comptes dans la barre, boutons flottants) ; jamais une carte du produit.
    4. Contrôle sur la planche : aucune case vide, aucun grand vide en bas (sauf pré-session et séance en
       direct, hauteur réelle de leur contenu), aucun « - » en colonne IA, aucun « marché fermé ».
- **Structure de la home après l'audit du 2026-10-06** : Hero prop firm (+ ligne de confiance
  factuelle `.hero-trust`, ordonnée après les CTA en mobile), « Ta prop firm, en direct », timeline
  d'un prop trader (trade qui arrive seul, marge en direct, anti-tilt), **6 cartes** fonctionnalités
  hiérarchisées (suivi prop firm en tête ; récap 17h30 et score regroupés), Coach IA raccourci (bloc
  « 3 étapes » retiré). **Aucune affirmation d'exclusivité** (« le seul », « le premier ») : non
  défendable face aux concurrents (cf. `docs/veille-focuspips.md`).
- **Clics CTA → GA4** (`Analytics.astro`) : tout lien avec `data-ga-event` (`cta_signup`, `cta_demo`,
  `cta_trial`, `cta_founder`, `cta_login` pour le bouton « Ouvrir l'app » de la 404) et `data-ga-place`
  envoie un événement GA4, SEULEMENT si GA est chargé (après consentement). Nouveau CTA d'inscription →
  ajouter les deux attributs (fin d'article `article`, témoignages `temoignages`,
  /journal-trading-prop-firm `jtp-hero` et `jtp-final` depuis #1067). Les liens d'inscription écrits dans
  le texte d'un article (`<a href="{APP_URL}/register">`) reçoivent les attributs au rendu
  (`pages/blog/[slug].astro`, place `article-texte`) : garder cette forme exacte dans le Markdown.
- **Tarifs (`Pricing.astro`, `PfPricing.astro`)** : les cartes Gratuit / Fondateur / Premium lisent
  `PLAN_BENEFITS` (`@mtc/shared`, liste partagée avec l'app et les e-mails, cf. plans.md « Avantages
  affichés ») ; jamais de liste d'avantages écrite dans la carte. Le bloc « Ce que Premium ajoute au
  Gratuit » de la home garde un détail propre (`premiumDetails`) : chaque ligne = fonction livrée ET
  réservée au Premium. `#pricing` a `scroll-margin-top` = barre fixe (60 px) : le menu « Tarifs »
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
    `mtc_offer_bar_closed`). Prop `href` (défaut `/#pricing`) : une page qui a ses propres tarifs y
    passe son ancre (`/prop-firm` → `#tarifs`), sinon le bandeau ferait sortir le visiteur de la page.
  - `Pricing.astro` : carte Fondateur au centre (`.is-founder`), `.has-founder` sur la section
    → 3 colonnes, Premium perd sa mise en avant ; ≤ 1024 px empilées, Fondateur en premier, et dans
    la carte **prix, bouton, PUIS fonctionnalités** (`order` CSS). Même liste `PLAN_BENEFITS.premium` que la
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
  - Hero, mobile seulement : raccourci « 🔥 Offre fondateur : 29 €/mois » (`#fondateur`)
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
  - **Logique client partagée** : `src/lib/founder-pricing.ts` (`initFounderPricing(section)` : compteur,
    insertion depuis le gabarit, retrait, paramètres de suivi recopiés du lien `.is-premium`). Toute page
    qui affiche la carte Fondateur l'appelle avec sa section ; jamais de copie du script. Le garde
    `libs/shared/src/founder-seats-usage.spec.ts` vérifie que ce module passe par `founderSeatsLabel`.
