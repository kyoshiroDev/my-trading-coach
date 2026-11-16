# PROMPT : trafic organique (Google) et visibilité dans les réponses des IA, chantier complet par phases

Objectif : améliorer durablement la découverte de MyTradingCoach par la recherche (Google, Bing) et par les IA qui citent des sources. Aucune promesse de résultat : on met en place les bonnes pratiques mesurables, par petites PR relues.

Tu travailles lentement, tu prouves chaque point, tu t'arrêtes au moindre doute. Landing : apps/landing-mytradingcoach (Astro, FR, tutoiement, site https://www.mytradingcoach.app).

## Règles absolues
- Périmètre : le repo, la landing et son contenu. Aucune action sur le VPS, Stripe, la prod, les comptes de recherche (Search Console, Bing), les réseaux sociaux ou les annuaires : ce sont des actions de l'utilisateur (liste en fin de prompt). Aucun déploiement.
- Aucun secret affiché ou écrit. Pas de tiret cadratin dans les textes visibles.
- Conformité AMF (#881), partout : aucune promesse de gain, pas de « rentable » ni « edge », aucune instruction d'achat ou de vente, aucune prévision. Les outils et pages décrivent et calculent, ils ne conseillent pas.
- Rien d'inventé : aucun avis, note, témoignage, chiffre de trafic ou nombre d'utilisateurs fabriqué. Pas de schéma AggregateRating ni Review sans vrais avis publiés.
- Ne change aucune URL existante. Si un changement d'URL est vraiment nécessaire, redirection 301 et demande-moi d'abord.
- Une page gatée par une fonctionnalité éteinte ne doit JAMAIS entrer dans le sitemap (règle déjà dans astro.config) : conserve-la.
- Garde la mention d'affiliation NinjaTrader telle qu'elle est.
- Une seule suite lourde à la fois, 2 workers maximum.
- Une branche par phase, depuis origin/dev à jour, une PR par phase vers dev (jamais main, aucune promotion).

## Phase 0 : audit, lecture seule (puis STOP)
Livre un rapport, ne code rien :
1. Inventaire des pages, titres, meta descriptions, canonical, Open Graph et image par page, hiérarchie des titres, textes alternatifs, pages orphelines, doublons de titres.
2. Données structurées présentes et manquantes (Organization, WebPage, Article, BreadcrumbList déjà là ; SoftwareApplication, FAQPage absents ?). Dis lesquelles sont valides.
3. Maillage interne : liens blog vers pages et inversement, pages sans lien entrant.
4. Performance : mesure locale Lighthouse (mobile) de l'accueil, /prop-firm, /journal-trading-prop-firm, un article : LCP, CLS, INP/TBT, poids. Garde ces chiffres comme point de départ.
5. Les 12 articles : date de publication et de mise à jour, longueur, réponse directe dans les premières lignes ou non, FAQ ou non, sources citées, risques de conformité AMF.
6. robots.txt, sitemap, liens cassés, redirections. Fichier llms.txt absent ?
7. Les données des règles des 16 prop firms : où sont-elles (catalogue API, libs/shared, JSON), quels champs, y a-t-il une date de dernière vérification par firme, comment la landing peut les lire À LA COMPILATION (jamais d'appel API au chargement de la page).
8. Propose l'ordre des phases 1 à 5 avec l'effort de chacune. Puis arrête-toi et attends mon « GO phase N ».

## Phase 1 : technique et structure (branche feat/seo-technique)
- Titres et meta uniques et utiles par page (longueurs raisonnables), canonical, Open Graph et image par page, textes alternatifs manquants.
- Données structurées valides : SoftwareApplication (nom, catégorie, offres avec les prix lus depuis la source unique libs/shared, jamais écrits en dur), Organization avec les liens de profils officiels (sameAs) existants, FAQPage UNIQUEMENT sur les pages où la FAQ est visible, Article/BreadcrumbList cohérents.
- Fichier public/llms.txt court et factuel (qui, quoi, pour qui, liens vers les pages clés, limites : pas de conseil, lecture seule). Dis dans le rapport que son effet n'est pas prouvé.
- robots.txt : garde l'accès ouvert aux robots de recherche et d'IA (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, bingbot). Ne bloque rien.
- Maillage interne : liens contextuels blog/pages/outils, pied de page, fil d'Ariane. Corrige les pages orphelines.
- Performance : aucune régression par rapport à la phase 0 (compare), images en chargement différé et dimensionnées, pas de décalage de mise en page.
- Valide les données structurées avec un validateur local ou la documentation de schema.org. Pas de service externe qui exige un secret.

## Phase 2 : mise à jour des 12 articles existants (branche feat/seo-articles-maj)
- Réponse directe dans les deux premières lignes, plan clair, bloc FAQ (3 à 5 questions réelles) avec schéma, date de mise à jour réelle, liens internes, sources officielles citées quand un fait est affirmé.
- Corrige tout texte contraire aux règles AMF ci-dessus. Liste ce que tu as changé article par article.
- Ne réécris pas pour réécrire : un article correct reste tel quel, tu le dis.

## Phase 3 : pages « règles des prop firms » (branche feat/seo-pages-firmes)
- Une page par firme et par taille de compte principale, générée À LA COMPILATION depuis le catalogue (source unique, jamais de recopie manuelle) : règle de drawdown (type, taille), objectif, règle de cohérence éventuelle, explication du calcul de la marge avant la limite, tableau, date de dernière vérification.
- Les chiffres viennent du catalogue. Si le catalogue n'a pas de date de vérification ou si une donnée est absente ou douteuse, la page n'est PAS publiée (exclue du sitemap) et tu la listes dans le rapport. Tu n'inventes aucune règle. Tu peux lire les pages publiques officielles des firmes pour comparer, avec l'URL et la date, et tu signales tout écart sans corriger le catalogue.
- Mention visible : « MyTradingCoach n'est affilié à aucune prop firm. Règles données à titre d'information, vérifie-les auprès de la firme. » Pas de logos de firmes, pas de claim d'affiliation.
- Page d'index des firmes, réponse directe en tête, FAQ visible avec schéma, liens vers l'outil de calcul de marge et vers la démo.
- Une page est ajoutée au sitemap seulement si ses données sont complètes et vérifiées.

## Phase 4 : outils gratuits sans compte (branche feat/seo-outils)
- Calculateur de marge avant la limite d'une prop firm (taille de compte, type de drawdown, solde, résultat du jour), calculateur de taille de position selon un risque en $ ou en %, calculateur de risque/rendement. Les règles de drawdown viennent du même catalogue.
- Tout se calcule dans le navigateur : aucune donnée envoyée ni stockée, aucun cookie nouveau, aucun traceur. Libellés neutres, mention « Outil de calcul à titre informatif, pas un conseil d'investissement. »
- Accessibles au clavier, lisibles sur mobile (360 px) sans défilement horizontal, textes de résultat compréhensibles par un lecteur d'écran.
- Un lien discret vers la démo ou l'inscription après le résultat, sans bloquer l'outil.
- Tests de calcul (cas limites : solde sous la limite, taille nulle, valeurs négatives, très grandes valeurs).

## Phase 5 : brouillons de contenu, aucune publication (branche feat/seo-brouillons)
- 4 brouillons d'articles, pas publiés (champ brouillon si le blog le gère, sinon fichiers exclus du build et du sitemap, vérifie comment le blog traite les dates futures) : « importer ses trades Tradovate dans un journal », « Lucid vs Apex : comprendre les différences de drawdown », « calendrier économique pour futures : quoi regarder, sans conseil », « comment choisir un journal de trading pour prop firm ».
- Format : réponse directe en tête, plan, FAQ, sources, date, liens internes. Zéro promesse de gain.
- 1 brouillon de page de comparaison honnête avec deux concurrents connus (TraderSync, Tradezella) : uniquement des faits vérifiables sur leurs pages publiques, avec URL et date de consultation, aucun dénigrement, forces et limites de chacun, y compris celles de MTC. Marqué « à valider par l'utilisateur » : il ne passe jamais en ligne sans mon accord.

## Tests et vérifications (chaque phase)
- Lint, typecheck, build de la landing sans erreur ni avertissement nouveau. Tests existants verts, tests ajoutés quand il y a du calcul ou de la génération de pages.
- Sitemap généré : liste des URLs avant/après, aucune page gatée ou brouillon dedans, lastmod correct.
- Captures des pages nouvelles à 390 px et 1440 px (sans donnée personnelle), aucune barre de défilement horizontale.
- Lighthouse mobile avant/après sur les 4 pages de la phase 0, aucune régression de LCP/CLS.
- Aucun contenu contraire à l'AMF : relecture ciblée du texte ajouté.

## Relecture : validation à 100 % avant tout push
À la fin de CHAQUE phase, lance l'agent de relecture (PROMPT-agent-relecteur.md), en lecture seule sur le diff. Il doit valider TOUS les points à 100 % : périmètre, conformité AMF, absence de données inventées, sources des chiffres, sitemap, structurées valides, performance, accessibilité, tests, lint. Un point non validé : tu corriges et relances la relecture complète. Tu ne pousses rien avant 100 %.

## Push et PR (autorisation donnée ICI)
Pour chaque phase que j'ai confirmée par « GO phase N » : une fois le relecteur à 100 %, tu peux pousser la branche de la phase et créer la PR vers dev. Jamais vers main, aucun merge, aucune promotion, aucun déploiement. Corps de PR : pourquoi, ce qui change, preuves, résultat de la relecture. Lignes de signature habituelles.

## Rapport par phase (un seul message)
Verdict du relecteur, fichiers, mesures avant/après, pages ou données exclues et pourquoi, lien de la PR, état de la CI (distingue un rouge dû au diff d'un rouge dû aux tests à date figée connus).

## Ce que TU ne fais pas (actions de l'utilisateur, à rappeler dans ton rapport final)
1. Renouveler le certificat du site www avant le 14/12.
2. Vérifier le domaine dans Google Search Console et Bing Webmaster Tools, soumettre le sitemap, relever les requêtes.
3. Publier hors site : réponses sincères sur Reddit et forums de traders, communautés Discord et YouTube francophones, annuaires (AlternativeTo, SaaSHub, Product Hunt, Indie Hackers), en se présentant comme fondateur.
4. Demander au support NinjaTrader un lien depuis leur annuaire ou leur newsletter.
5. Mesure mensuelle : poser les mêmes 10 questions à ChatGPT, Perplexity, Gemini et Claude, noter qui est cité.
6. Valider les brouillons et la page de comparaison avant toute mise en ligne.

---

## Compléments de Greg

- 2026-11-16, après le rapport de la phase 0 : « GO phase 1, option a, sameAs vide pour l'instant »

- 2026-11-16, après la PR #1076 (phase 1, CI verte) : « continue », pris comme « GO phase 2 ». Branche feat/seo-articles-maj partie de feat/seo-technique (FAQ et JSON-LD des articles reposent sur la phase 1), à mettre à jour par merge de origin/dev si besoin (pas de rebase d'une branche poussée).

- 2026-11-16, après les PR #1076 et #1078 (mergées) : « GO phase 3, pas de seuil, 50K »
