# Page `/prop-firm` et redirection de l'accueil

> Contenu déplacé à l'identique depuis `.claude/agents/astro.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : astro.md · Page `/prop-firm` (test publicitaire, oct. 2026) · 2026-10-18 -->
> **Origine** : `astro.md` · « Page `/prop-firm` (test publicitaire, oct. 2026) » · 2026-10-18

## Page `/prop-firm` (test publicitaire, oct. 2026)

Landing épurée pour le **trader futures en prop firm** (tests de lecture du 17-18/10 : la home
était jugée trop dense, trop d'emojis, et lue « crypto »). Comparée à la home via les clics CTA de
l'admin : **seul le lien de la pub** y pointe (UTM dédiées), la home ne change pas.

- Fichiers : `src/pages/prop-firm.astro` + `src/components/prop-firm-page/` (`PfHeader`, `PfRules`,
  `PfPricing`). Maquettes : `maquettes/maquette-landing-prop-firm-{mobile,desktop}.html` (locales).
  Page d'entrée du site tant que `/` y redirige : ne pas la supprimer (et jamais avant fin novembre 2026).
- **Indexable depuis le 2026-11-16** (SEO phase 1, #1071, option a de Greg) : plus de `noindex`,
  canonical vers elle-même, dans le sitemap (priorité 1.0, `astro.config.mjs`). Avant : noindex et
  hors sitemap (page de test publicitaire). JSON-LD : `WebPage` + `SoftwareApplication` +
  `Organization` + `WebSite` + `FAQPage` construite depuis le tableau `faq` AFFICHÉ (même texte).
  Image de partage `/og/prop-firm.jpg`. Détail SEO : `reference/astro/seo-technique.md`.
- Même `Base.astro` (UTM, `/public/visit`, `cta_click`, bandeau cookies, mode interne) et même
  `Footer.astro`. En-tête propre (logo `logo-navbar.svg`, ancres + inscription sur ordinateur,
  « Se connecter » seul en mobile), sans barre sticky. **Même `FounderBanner`** que l'accueil
  (inclus par `PfHeader`, `href="#tarifs"`) : l'en-tête descend de 32 px par transform
  (`html.has-offer-bar .pfh`), ancres sous l'en-tête par `scroll-padding-top` de `html` (60 px, 92 px
  avec le bandeau), haut de page mobile à 44 px pour que le bandeau ne touche pas le libellé.
- **Pas d'emoji hors footer**, icônes en SVG, sauf deux exceptions voulues : le 🔥 du bandeau de
  l'offre (composant partagé) et la ligne de confiance sous les boutons du haut (`.pf-trustline`,
  « 🇫🇷 Fait en France · Indépendant · Sans publicité · Référencé dans l'écosystème NinjaTrader »,
  sans logo ; « Sans publicité » a remplacé « Tes données ne sont jamais vendues » le 2026-10-22,
  les autres occurrences, accueil et FAQ, attendent la validation de Greg) ; aucun logo de prop firm (noms en texte) ; logo
  NinjaTrader dans le bloc `NinjaTraderTrust` sous la carte d'exemple (cf. « Wordmark NinjaTrader »)
  et au footer, formulation factuelle (clause 17).
  « Crypto » / « forex » seulement dans « Et aussi » et la FAQ, jamais en haut ni dans la description.
- **« Compatible avec »** (`components/Compatible.astro`, oct. 2026) : après « Prêt en 2 minutes »
  (`width={1200} gutter={20}`) et sur l'accueil après `PropFirmLive`. Deux entrées en texte seul :
  Tradovate (API, lecture seule, aucun ordre ; **pas de logo Tradovate**, aucune autorisation) et
  saisie manuelle (+ import CSV « quand ta plateforme est reconnue »). N'y ajouter **ni NinjaTrader
  Desktop / Web** (en attente de confirmation de NinjaTrader) **ni aucun autre nom** de courtier ou
  de plateforme.
- Sélecteur firm → plan → phase : même catalogue (`buildPropFirmCatalog`) et même logique que la home
  via `src/lib/prop-firm-picker.ts` (pur, sans DOM : sélection initiale Apex 50K EOD, 50K par défaut à
  chaque firm, date de relevé `sourceLabel`). `PropFirmLive.astro` l'utilise aussi. Puces = vrais
  `<button>`, 6 en vedette puis « + N autres ».
- Capture des règles **sur mobile** (≤ 900 px) : image dédiée `showcase/app-prop-firm-rules-mobile.webp`
  (640×1340, 2x, ~47 Ko), prise dans l'app en 390 px sur le compte démo prod (« Mes comptes », Apex
  50K EOD Trail déplié, Évaluation : la sélection par défaut du sélecteur), recadrée sur objectif,
  drawdown et perte journalière. La capture ordinateur réduite à 358 px donnait ~7 px de texte. Chaque
  taille ne charge que son image (lien masqué = image lazy non téléchargée). À refaire si l'écran des
  règles change dans l'app : `/demo?internal=1`, fenêtre 390 px DPR 2, aucune donnée ni e-mail réel.
- Textes de la page : espace insécable avant « ? », « ! » et « : » (pas de ponctuation seule en début
  de ligne). L'en-tête garde « Se connecter » sur une ligne (`white-space: nowrap`, 360 px compris).
- Carte d'exemple « Marge avant le plancher · 480 $ » (libellé de l'app, 09/11) : montant et barre en **jaune** (alerte), perte du jour en
  rouge (design.md : rouge = pertes uniquement), mention « Exemple avec des données de démonstration ».
  Les 3 petites cartes (objectif, perte, trades) : libellé et valeur **centrés**, valeurs sans retour à
  la ligne, les trois visibles aussi en mobile (une ligne, libellés réservés sur 2 lignes) (08/11).
- Haut de page : « Voir la démo » = **bouton secondaire** (contour `--blue` 2 px, icône lecture, même
  hauteur/arrondi/taille que « Commencer gratuitement »), mention mono « Sans compte · 1 min » dessous ;
  < 640 px les deux boutons empilés pleine largeur, inscription d'abord. Lien et `cta_demo` inchangés (08/11).
- Tarifs (`PfPricing`) : même mécanisme fondateur que la home (`founderOpen` au build + `initFounderPricing`),
  mêmes `data-cta` (`free` / `founder` / `premium`). Premium « Recommandé » quand la carte Fondateur
  est absente, « Prix normal » sinon. Listes courtes, « Comptes illimités » seulement si
  `FEATURES.multiAccounts`.
- Témoignages : section rendue seulement si `TEMOIGNAGES` n'est pas vide (ne rien inventer).
- La redirection de la pub (`utm_medium=paid`, script inline de `index.astro`, 2026-10-18) a été
  **retirée le 2026-11-08** : remplacée par la redirection de tout `/` (section suivante). Les gardes
  `window.__mtcPaidRedirect` de `Base.astro` et `Analytics.astro` et le slot `head-start` ont disparu
  avec elle.
- Mesure du 2026-10-18 (preview locale, iPhone 390×844, UA Instagram, Slow 4G 150 ms / 1,6 Mbit/s,
  CPU ×4) : LCP ≈ 0,7 s, chargement 1,5 s, 185 Ko, CLS 0,02 ; bouton du haut à 540 px, au-dessus du
  bandeau cookies même en 390×664. Après ajout du bandeau d'offre et de la ligne de confiance : bouton
  à 552 px (390×844), offre ouverte ou fermée, bandeau cookies à 755 px.
- Découpage CSS : /prop-firm n'ayant pas la Nav, Vite sépare la feuille `Nav` (assez petite depuis
  l'ajout du bandeau à /prop-firm pour être mise en ligne dans la page) — même contenu sur la home.

<!-- Origine : astro.md · Accueil → /prop-firm (redirection temporaire, 2026-11-08) · 2026-11-08 -->
> **Origine** : `astro.md` · « Accueil → /prop-firm (redirection temporaire, 2026-11-08) » · 2026-11-08

## Accueil → /prop-firm (redirection temporaire, 2026-11-08)

Pour la newsletter NinjaTrader (~10/11) : qui tape l'adresse du site arrive sur `/prop-firm`.
Refonte complète (contenu de /prop-firm servi sur `/`, canonical, sort de l'ancienne home) après la
newsletter.

- **302 nginx** (`landing-releases.conf`, `location = /` et `= /index.html`) → `/prop-firm` + query
  string intacte (`utm_*`, `ref`, `promo`, `internal`…). **En prod depuis le 2026-11-08**, appliquée
  à la main sur l'ancien VPS (la conf n'est pas déployée par la CD) : deploy.md, « Redirection
  temporaire de l'accueil ».
- **Page de secours** `src/pages/index.astro` : jamais servie quand la 302 est en place. Sans
  `Base.astro` (donc ni script d'acquisition, ni GA4, ni bandeau cookies), `noindex`,
  `location.replace('/prop-firm' + search + hash)`, `meta refresh` dans `<noscript>`, lien visible.
  Visite comptée une seule fois, sur /prop-firm, avec les UTM. Limite : sans UTM, le site d'origine
  est perdu (la visite sort en « direct ») ; la 302 nginx, elle, le garde.
- **Ancienne home** : `src/pages/accueil.astro` → `/accueil`, même contenu, `noindex`, sans canonical,
  hors sitemap. Pas suivie par l'engagement admin (seuls `/` et `/prop-firm` le sont).
- **Liens internes** directement vers /prop-firm (pas de détour par la 302) : logo et menu de `Nav`
  (`/prop-firm#comment`, `#prop-firms`, `#tarifs`, plus d'entrée FAQ), bandeau fondateur de `Nav`
  (`/prop-firm#tarifs`), logo de `PfHeader`, « ← Retour » des pages 404, légales, ambassadeur et
  journal-trading-prop-firm (dont les `/#pricing` → `/prop-firm#tarifs`). `<Nav home />` sur
  `/accueil` : ancres sur la page même (`#journee`, `#features`, `#pricing`, `#faq`).
- **Sitemap** : `/` et `/accueil` exclus (`astro.config.mjs`). /prop-firm y est et est indexable depuis le 2026-11-16.
- Liens externes inchangés (passent par la 302) : e-mails, liens de parrainage
  `https://mytradingcoach.app?ref=CODE` (308 Traefik vers www, puis 302 → `/prop-firm?ref=CODE`, le
  `ref` est capté par `Base.astro`), liens de l'app.
- **Point ouvert réglé le 2026-11-16** (option a) : /prop-firm indexable, la 302 de `/` gardée telle
  quelle. La refonte de l'accueil (contenu servi sur `/` sans 302) reste possible plus tard.
- **Retrait** : supprimer les deux blocs nginx (deploy.md), remettre `accueil.astro` en `index.astro`
  (canonical `/`, sans `noindex`, `<Nav />` sans `home`), restaurer les liens `/` et le filtre sitemap.

> **Tirage mensuel (#1158, 2026-11-21)** : section `PfGiveaway.astro` après la grille de prix, cachée
> par défaut et affichée côté navigateur seulement si `GET /public/giveaway` dit `enabled` (aucune
> donnée personnelle sans accord). Règlement : `/reglement-tirage` (noindex, exclu du sitemap dans
> `astro.config.mjs`). Détail : `commun/tirage-mensuel.md`.

## Bloc « Installe MyTradingCoach sur ton écran d'accueil » (#1198)

`components/prop-firm-page/PfInstall.astro`, entre la FAQ et le dernier appel. Textes validés par le
relecteur : sur-titre « Sur ton téléphone », titre, 3 lignes (ouverture en un geste ; « Pas de store, rien
à télécharger » pour ne pas contredire « rien à installer » de `contexte-com.md` ; alertes sur iPhone, sans
parler de plan), bouton « Installer sur mon téléphone » vers `${APP_URL}/installer`
(`data-ga-event="install_app"`, `data-ga-place="prop-firm"`). Sur ordinateur (`min-width: 900px` et
`hover: hover`, CSS seulement) : QR code (SVG inline généré au build par `qrcode`, modules sombres sur
fond clair, `aria-label`) et l'adresse en lien texte. Aucun JS côté navigateur.

