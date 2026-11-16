# Cookies et GA4 (consentement RGPD)

> Contenu déplacé à l'identique depuis `.claude/agents/astro.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : astro.md · Cookies & GA4 (consentement RGPD, oct. 2026) · 2026-10-02 -->
> **Origine** : `astro.md` · « Cookies & GA4 (consentement RGPD, oct. 2026) » · 2026-10-02

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
- **Le bandeau ne masque jamais le contenu** (21/10, le wordmark du footer était caché tant que le
  visiteur n'avait pas choisi) : tant qu'il est affiché, `.cc-spacer` (fin de `<body>`) réserve en bas
  de page sa hauteur **mesurée** (`offsetHeight`, ResizeObserver → recalculée au redimensionnement ;
  68 px à 1440/1920, 88 px à 768, 89 px à 390, 105 px à 320), remise à 0 au choix. Ne jamais la
  coder en dur. Vérifié : bas du footer = haut du bandeau à 390, 768, 1440 et 1920 px.
- **Source d'acquisition** (script UTM de `Base.astro`) : `utm_*` du lien, sinon **site d'origine**
  (`document.referrer` externe → `utm_source=<hôte sans www>`, `utm_medium=referral`), gardée en
  sessionStorage `mtc_utm` et ajoutée à tous les liens `/register`. L'app applique le même plan B
  si on arrive directement sur `/register` (`referrerHost` de `register.component.ts`).
  **Liens vers la démo** (`{APP_URL}/demo` exactement, #1029) : mêmes UTM, plus `ref` de l'URL
  (lettres, chiffres, `-`, `_`, 40 car.) et `internal=1` si le mode interne est posé sur www (le
  localStorage ne passe pas d'un domaine à l'autre) : le bouton « Créer mon compte » de la démo garde
  l'origine de la visite, et une ouverture en mode interne n'est pas comptée.
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
- **Engagement de `/` et `/prop-firm`** (19/10/2026, pour comparer les deux pages) : module
  `src/lib/engagement.ts` (script bundlé de `Base.astro`, différé, ~2 ko) → `POST /public/funnel` par la
  fonction d'envoi du script d'acquisition, exposée en `window.mtcFunnel` (même origine UTM, `inApp`,
  sendBeacon text/plain). Absente en mode interne et pendant la redirection de la pub → rien envoyé.
  Étapes `scroll_depth` (detail 25/50/75/100, `scrollDepthPercent` de `@mtc/shared`, à < 4 px du bas = 100),
  `time_on_page` (10/30/60 s **onglet visible**, minuteur suspendu sur `visibilitychange`), `rules_use`
  (1re utilisation du sélecteur : `click` sur un `button` ou `change` d'un `select` dans un conteneur
  **`[data-track-rules]`** : carte de `PropFirmLive`, carrousel `PropFirmMarquee`, `PfRules`), avec
  `path`. **Un envoi par seuil et par chargement de page** (pas par session : un rechargement recompte).
  Écouteur de défilement passif, calcul une fois par image, retiré après 100 %. Nouvelle page à mesurer
  → `LANDING_ENGAGEMENT_PAGES` (shared) + filtre `path IN (…)` de `LandingEngagementService`. Nouveau
  sélecteur → poser `data-track-rules`. Résultat : carte « Engagement landing » de l'admin `/acquisition`.
- **Un appui = un clic** (oct. 2026) : l'app met ~1 s à s'afficher en 4G lente et le bouton ne
  réagissait pas → les visiteurs réappuyaient (2 `cta_click`, 2 navigations). Un 2e écouteur, enregistré
  AVANT celui du comptage (et même en mode interne), passe le lien à « Ouverture… » (classe
  `a.is-opening` de `global.css` : estompé, largeur gardée, `aria-busy`) et ignore 2 s les appuis
  suivants sur CE lien (`preventDefault` + `stopImmediatePropagation` : ni navigation ni clic compté).
  Le 1er appui part toujours ; Ctrl/Cmd/Maj/clic milieu (nouvel onglet) non concernés ; `pageshow`
  (retour arrière, cache de navigation) rétablit le bouton. Le libellé change APRÈS l'événement
  (`setTimeout 0`) : le remplacer pendant détacherait `ev.target` et l'écouteur de comptage ne
  retrouverait plus le lien.
- **`preconnect`** dans le `<head>` de `Base.astro` vers l'origine de `APP_URL` (connexion TLS prête
  avant l'appui) et de `API_URL` (`crossorigin` : visite et clics partent sans cookie).
- **Mode interne** (visites de l'équipe) : ouvrir `https://www.mytradingcoach.app/?internal=1` →
  localStorage `mtc_internal=1` (`INTERNAL_STORAGE_KEY`) : plus aucune visite ni étape envoyée depuis ce
  navigateur, badge discret « interne » en bas à gauche (`.internal-badge`, `global.css`).
  `?internal=0` annule. Propre au domaine : l'app a le sien (`app.mytradingcoach.app/?internal=1`).
  GA4 n'est pas concerné (il dépend du consentement).
- Politique de confidentialité, section 6 : le paragraphe « Mesure d'audience sans cookie » décrit
  aussi les étapes de l'inscription, le booléen navigateur intégré et l'engagement de l'accueil et de
  /prop-firm (défilement, temps, sélecteur). Toute nouvelle mesure → l'y ajouter.
- Politique de confidentialité, push et autopsie (1.g, bases légales, durées, destinataires) : voir
  `security.md`. Guillemets français de la page : `«&nbsp;…&nbsp;»` (sinon « » orphelin à 390 px).
- Nouveau traceur (pixel, Hotjar…) = même règle : chargé par `Analytics.astro` après consentement,
  et déclaré dans la politique de confidentialité.
- Cookies GA : `cookie_expires` à 13 mois dans `gtag('config')` (GA4 met 2 ans par défaut ; la
  politique annonce 13 mois, #745).
- **Toute clé de stockage navigateur de la landing** (localStorage / sessionStorage) est listée
  nommément en section 6 de la politique (« Stockage du navigateur sur le site vitrine »), avec sa
  durée. Nouvelle clé = nouvelle ligne, dans le même commit (#745).
- Stockage de **l'app** : déclaré par familles dans la même section 6 (« Stockage du navigateur
  dans l'application » : `access_token`, `user`, clés `mtc.*` / `mtc_*`, `sidebar_collapsed`,
  `ambassador_last_seen`), avec Stripe.js (`__stripe_mid`, `__stripe_sid`) et le script Google
  chargé à l'affichage du bouton. Nouvelle clé hors de ces familles → l'ajouter (#747).
- Listes Gratuit / Premium des CGU (section 5) : alignées à la main sur `PLAN_BENEFITS`
  (`@mtc/shared`) et le détail Premium de `Pricing.astro`. Changer un avantage → les CGU aussi (#747).
- Pages légales : n'y écrire que ce que le code fait (audit du 25/10, #745/#747). Pas d'export CSV
  libre-service (portabilité **sur demande**), conservation « jusqu'à la suppression du compte »,
  hébergeur unique OVH (pas de Vercel), l'IA s'appuie AUSSI sur des annonces économiques publiques
  (calendrier éco) : jamais « exclusivement vos données ». Changer un texte → date « Dernière mise
  à jour » de la page.
- **Modifier les CGU (`cgu.astro`) → changer `CGU_VERSION` (`libs/shared/src/terms.ts`) dans le même
  commit** : c'est la version enregistrée sur chaque compte créé (`User.termsVersion`, #745 F2).
