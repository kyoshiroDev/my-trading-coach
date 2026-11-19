# Astro 7 et audit UX

> Contenu déplacé à l'identique depuis `.claude/agents/astro.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : astro.md · Astro 7 (étape 5 de l'audit, 2026-09-13) · 2026-09-13 -->
> **Origine** : `astro.md` · « Astro 7 (étape 5 de l'audit, 2026-09-13) » · 2026-09-13

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

<!-- Origine : astro.md · Règles issues de l'audit UX (2026-09-27) · 2026-09-27 -->
> **Origine** : `astro.md` · « Règles issues de l'audit UX (2026-09-27) » · 2026-09-27

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
- **Adresse de contact publique unique : `support@mytradingcoach.app`** (#747) : pied de page, pages
  légales, JSON-LD. Plus de `contact@` (boîte non vérifiée) ni de `hello@` (adresse interne, jamais
  montrée aux utilisateurs).

## Contraste des boutons bleus (#1079, 2026-11-17)

- **Texte sur un fond bleu plein** (boutons, CTA de la nav, barre sticky mobile, bandeau fondateur, onglets actifs) : toujours `color: var(--on-blue)`, jamais `#fff` ni `white`. `--on-blue` vaut `var(--bg)` : 5,4:1 sur `--blue`, 7,8:1 sur `--blue2` (survols, bouton de la 404). Le blanc n'y faisait que 3,7:1 et 2,5:1, sous le minimum de 4,5:1.
- Dégradés `--blue` → `#6366f1` (Pricing, Testimonials, bandeau fondateur) : toujours opaques (un fond semi-transparent laisse passer le noir et fait chuter le contraste). Environ 4,9:1 au centre, 4,46:1 à l'extrémité indigo. Le « × » du bandeau fondateur est en `--on-blue` plein, sans opacité.
- Fin des dégradés indigo : token `--indigo` (#1084), jamais `#6366f1` en dur. Bouton des articles de blog (`.article-cta-btn`) en `--blue` plein comme les autres CTA (le dégradé bleu-cyan est retiré : le cyan `--pulse` est réservé au direct et à l'IA). Le « × » du bandeau fondateur est une icône SVG (tracé Lucide `x`) ; le 🔥 du bandeau reste, exception voulue (`prop-firm.md`).
- Halo des CTA bleus : tokens `--blue-halo` (40 %), `--blue-halo-hover` (50 %, survol) et `--blue-halo-strong` (55 %, survol de `.btn-p`) dans `global.css` (#1091), plus de `rgba` en dur pour ces trois intensités. Nom distinct de `--blue-glow` de l'app (15 %). Toutes les autres teintes transparentes du bleu (halos discrets, fonds, bordures, ombres de carte) s'écrivent `color-mix(in srgb, var(--blue) X%, transparent)`, même rendu qu'un `rgba` (#1095) : plus aucun `rgba(59, 130, 246, …)` en dur hors de ces trois tokens.
- Teintes hors bleu (#1098) : même écriture `color-mix(in srgb, var(--token) X%, transparent)` sur `--green`, `--yel`, `--red`, `--pulse`, `--blue2`, `--bg2`. Nouveaux tokens dans `global.css` : `--purple` / `--purple-bright` (mêmes noms que l'app, moments « après » et comptes perso), `--reflet` (`var(--txt)`, reflets et séparateurs translucides seulement, jamais un fond plein) et `--edge` (`#639bff`, base de `--b` et `--b2`, eux-mêmes en `color-mix`). Restent en dur, volontairement : ombres noires `rgba(0, 0, 0, …)`, masques `#000` de PropFirmMarquee, `<meta name="theme-color">` (attribut HTML), page de secours `pages/index.astro` (sans `global.css`) et `public/icon/og-image.svg` (SVG autonome).
- Usages des couleurs (#1100), règle 3 de l'agent design : le vert reste aux gains (P&L positifs, statut funded du maquettage multi-comptes, comme dans l'app) et le violet ne sert plus à décorer. Code des moments de la journée : avant = neutre (texte `--txt2` sur teinte `--edge`, point bordé `--txt3`), pendant = bleu, après = cyan `--pulse` (récap et débrief IA), alerte = `--yel` (pastille « Alertes avant la casse » du Hero comprise). Les classes touchées ici sont nommées par rôle (`.avant`, `.pendant`, `.apres`, `.alerte`, `.ic-neutre`, `.pt-neutre`) ; les autres gardaient alors leur nom de couleur (icônes `.ic-*` renommées dans #1104). `--purple` / `--purple-bright` restent définis sans usage sur la landing. Bandeau « Fait en France » et tag « Gratuit » neutres ; tag « perso » comme dans l'app ; dégradés violets des cartes Premium et d'analyse IA → `--indigo`. Coches ✓ des listes (tarifs, confiance du Hero, comparatif, PropFirmLive) en `--blue2`, comme les « + » de l'encadré Premium (#1104) ; message de succès du formulaire ambassadeur en `--txt` ; montant de gain (commission ambassadeur) gardé en vert, classe `.gain` ; mois offert au parrain en `--blue2`, comme la remise filleul. Icônes des cartes (Features, Problem, MultiComptes) nommées par rôle : `.ic-regles`, `.ic-neutre`, `.ic-ia`, `.ic-stats`, `.ic-perte`, `.ic-alerte`, `.ic-comptes`.
- Aperçu du débrief (#1107) : le win rate cité dans l'analyse IA (« 72 % ») est en `--txt` comme les autres chiffres en gras du texte, plus en vert : ce n'est pas un gain. La carte « Win rate 67 % » de l'aperçu passe en `--green` (#1112), comme la carte « Win Rate » du débrief de l'app (vert à 50 % ou plus) : le chiffre est en dur, donc toujours vert.
- Valeurs numériques en `--mono` + `tabular-nums` (#1116, règle 4 de l'agent design) : cartes de l'aperçu débrief (`.dm-val`, graisse 500 comme `.stat-value` du débrief de l'app), montants des tarifs (`.price-amt-num` / `.price-amt-cur` de Pricing, `.pp-amt` de PfPricing, graisse 600 comme le prix du checkout de l'app ; le symbole € y est sorti dans `.pp-cur`, plus petit et en `--txt2`, comme `.price-amt-cur`, car une espace en mono occupe une case entière) et compteur de comptes `.acct-n` (Pricing, masqué tant que `FEATURES.multiAccounts` est coupé). Restent en `--disp` : les montants de Referral et d'ambassadeur (`.ref-amt`, `.amb-rew-amt`), qui mêlent texte et chiffre (« +1 mois », « Mensuel »).
- P&L de l'aperçu débrief (#1119) : « +$1,840 », format de `formatMoney` (`libs/shared/src/currency.ts`) sans décimales, comme un montant de l'app, et `.dm-val` en `white-space: nowrap` : l'ancien « +$1 840 » se coupait sur deux lignes à 390 px. Les montants rédigés en français dans le texte de la landing gardent « 1 240 $ ». Le « +$620 » du récap de la veille (DayTimeline) passe ainsi en « +620 $ » (#1121). Le reste de la timeline suit (#1123) : insécables avant « : » et « ? » des paragraphes, « 240 $ » insécable, et « Récap » accentué comme dans l'app (« Récap du jour »). Les intitulés des étapes (`.day-tag`, avec emoji) attendent #1092.
- Orthographe (#1126) : « récap » accentué et « e-mail » (pas « email ») dans tout le texte visible de la landing, pages légales comprises, comme le texte de l'app (très majoritairement « e-mail »). Les identifiants de code (`type="email"`, `name="email"`, `cta=email`, champ `email` du JSON-LD) ne changent pas ; reste « Recap automatique » dans un intitulé d'étape de DayTimeline, gelé par #1092.
- Typographie (#1130) : espace insécable avant `: ; ! ? %` dans le texte visible des gabarits (`&nbsp;`) et dans les chaînes JS affichées (`\u00a0` : frontmatter, `src/data`, `src/lib`). Restent en espace simple : commentaires, attributs (`alt`, `aria-label`, `title`, `description`) et intitulés d'étapes de DayTimeline (gelés par #1092). « Weekly Debrief » devient « Débrief hebdo », le libellé de l'app ; « débrieffe » corrigé en « débriefe ». Reste « Weekly Debrief » dans un intitulé d'étape de DayTimeline (#1092).
- Mention « Lien affilié » du pied de page : `var(--txt3)` sans opacité (5,9:1 sur le fond). Avec `opacity: 0.75`, elle tombait à 3,8:1.
- Vérification : Lighthouse en accessibilité (audit `color-contrast`), sur un build local relié à une API morte (`seo-technique.md`).
