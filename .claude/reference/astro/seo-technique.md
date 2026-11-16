# SEO technique de la landing

> Créé le 2026-11-16 (PROMPT-seo-visibilite-ia, phase 1, #1071). À mettre à jour à chaque changement
> de ces règles.

## Pages indexables et sitemap
- Indexables : `/prop-firm` (page d'entrée, `/` y redirige en 302), `/journal-trading-prop-firm` et
  `/ambassadeur` (si leur feature est en ligne), `/blog` et ses articles, pages légales.
- Hors index : `/` (page de secours de la 302), `/accueil` (ancienne home), `/404`.
- Sitemap (`astro.config.mjs`) : une page gatée n'y entre JAMAIS tant que sa feature est éteinte
  (`PUBLIC_FEATURE_*` lus au build). `lastmod` seulement sur les articles (date réelle du frontmatter).
  `/llms.txt` n'y figure pas (non HTML).

## Titres, descriptions, canonical
- `<title>` unique, 60 caractères environ ; description 155 caractères environ, tutoiement.
- Canonical sans slash final (`trailingSlash: 'never'`), calculé par `Base.astro` sauf passage explicite.

## Open Graph
- `Base.astro` : `ogType` (`article` pour les articles, avec `article:published_time` /
  `article:modified_time`), `ogImage` (chemin sous `public/`, 1200×630), `ogImageAlt`.
- Images : `public/og/*.jpg` (pages) et `public/og/blog/<slug>.jpg` (une par article), défaut
  `og/default.jpg`. Générées par `node tools/scripts/generate-og-images.mjs` (titre = H1 de la page ou
  `title` du frontmatter). **Nouvel article ou titre modifié → relancer le script** :
  `libs/shared/src/blog-related-posts.spec.ts` échoue si une image d'article manque. Fichiers non
  hashés servis par `location /` de nginx (cache 1 h, must-revalidate) : inutile de les renommer.
- `public/icon/og-image.png` (ancienne image, en anglais) n'est plus utilisée par les pages ; gardée
  pour les liens externes déjà partagés.

## Données structurées (`src/data/schema.ts`)
- Une seule `Organization` (`@id` `…/#organization`), un `WebSite` (`…/#website`) ; toute référence
  `@id` doit viser une entité présente dans la même page (articles : `Organization` ajoutée).
- `SoftwareApplication` (offres Gratuit, Premium mensuel et annuel, prix lus dans `PREMIUM_PRICE_EUR`)
  sur `/prop-firm` (et `/accueil`, noindex). Pas de résultat enrichi Google sans note : c'est voulu,
  jamais d'`aggregateRating` ni de `Review` sans vrais avis publiés.
- `FAQPage` seulement là où la FAQ est visible, construite par `faqPage()` depuis le tableau affiché.
  Articles : champ `faq` du frontmatter, affiché en bas de l'article et repris dans le FAQPage
  (`reference/astro/seo-blog.md`, « Format d'un article »).
- `WebPage` (`webPage()`) sur `/prop-firm` et `/journal-trading-prop-firm`.
- Articles : `Article` (image = image de partage, auteur et éditeur = l'Organization) +
  `BreadcrumbList` identique au fil d'Ariane visible (`Accueil` = `/prop-firm`, `Blog`, titre).
- `sameAs` vide tant que Greg n'a pas donné les URL des profils officiels (décision du 2026-11-16).
- Invariants testés dans `libs/shared/src/blog-related-posts.spec.ts` (la landing n'a pas de suite de
  tests) ; la cible `shared:test` déclare les fichiers de la landing dans ses `inputs`, sinon le cache
  Nx sauterait le test quand seule la landing change.
- Vérification locale : propriétés requises, `@id` résolus, FAQ et fil visibles dans la page (script de
  la phase 1, pas de service externe).

## Mesures locales
- Lighthouse, captures : builder avec `PUBLIC_API_URL=http://127.0.0.1:9/api`, sinon chaque chargement
  de la preview appelle `/public/visit` en prod (incident du 2026-11-16 : préflight seulement, POST
  bloqué par CORS, a priori rien d'enregistré).

## robots.txt et llms.txt
- `public/robots.txt` : rien de bloqué (les CSS/JS de `/_assets/` servent au rendu), robots de
  recherche et d'IA nommés et autorisés (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, bingbot…).
- `/llms.txt` : généré au build par `src/pages/llms.txt.ts` (prix, essai et nombre de firmes depuis
  `@mtc/shared`). Court et factuel : qui, quoi, pour qui, limites (pas de conseil, lecture seule),
  pages clés. Effet sur les moteurs non prouvé (convention, pas un standard).

## Maillage interne
- Articles : fil d'Ariane visible, bloc « À lire aussi » (3 articles par tags communs puis les plus
  récents, `relatedBlogPosts` de `@mtc/shared`) + lien vers `/journal-trading-prop-firm` si
  `FEATURES.multiAccounts`.
- Pied de page : Blog, Journal prop firm (si multiAccounts), Ambassadeurs (si referral).
- Liens internes vers l'accueil : `/prop-firm` directement, jamais `/` (302).

## Pages « règles des prop firms » (phase 3, 2026-11-16)
- URLs : `/regles-prop-firm` (index) et `/regles-prop-firm/<firm.id>-50k`, générées AU BUILD.
- Sélection : `firmRulePages()` de `@mtc/shared` (`prop-firm-rules/firm-pages.ts`) : taille 50K seulement
  (décision de Greg du 2026-11-16), plans `public`, sans `needs_review`, drawdown chiffré à chaque phase,
  objectif à l'évaluation. Aucun seuil d'ancienneté : la date `verified_at` est affichée. Une firme sans
  plan publiable n'a pas de page (donc pas d'URL au sitemap).
- Contenu : `src/data/prop-firm-pages.ts` (vue compacte `buildPropFirmCatalog`, libellés `ruleRows`),
  exemple de marge calculé par `drawdownFloor`, sources = `help_center` + `source_urls` des plans publiés.
  Mention obligatoire `FIRM_RULES_DISCLAIMER` (« MyTradingCoach n'est affilié à aucune prop firm… »).
  Pas de logo de firme. FAQ visible + FAQPage sur l'index.
- Sitemap : `lastmod` = `verified_at` de la firme (index : la plus récente), lus dans les JSON du catalogue
  par `astro.config.mjs`.
- Styles : `src/styles/firm-rules.css` (tokens de la landing).
- Tests : `libs/shared/src/prop-firm-rules/firm-pages.spec.ts` (sélection, catalogue réel, invariants
  des pages).
- Lien vers le calculateur de marge : à ajouter avec la phase 4 (outils).
