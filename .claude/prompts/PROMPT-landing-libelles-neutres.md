# PROMPT : libellés neutres (AMF) et précisions factuelles sur la landing et les news en séance

Branche : fix/landing-libelles-neutres, créée depuis origin/dev à jour. Tu travailles lentement, tu prouves chaque point (fichier:ligne, capture sans donnée personnelle), tu t'arrêtes au moindre doute. Contexte : le rapport du 19/11 (issue #1136) a montré que la landing publique affiche encore des libellés directionnels que l'application a retirés depuis #881, et que plusieurs textes sont plus forts que la réalité. Les IA les répètent déjà.

## Règles absolues
- Périmètre strict : les points A à G ci-dessous. Tout le reste, tu le signales sans le toucher.
- Aucun secret affiché ou écrit. Aucune commande sur le VPS, Stripe, la prod. Base locale de test uniquement.
- Une seule suite lourde à la fois, 2 workers maximum. Pas de tiret cadratin dans les textes visibles.
- Aucun force push, aucune autre branche, aucune promotion vers main (Greg décide de la mise en production avec la date de la newsletter).
- Conformité AMF (#881) : aucune promesse de gain, pas de « rentable » ni « edge », aucune direction de marché, aucune prévision, aucun conseil d'achat ou de vente.
- Ne retire aucune fonctionnalité : seuls les textes et libellés changent (sauf B, où seul l'affichage du sentiment directionnel est retiré).

## A. Landing : libellés neutres (décisions de Greg)
Remplace, aux endroits relevés dans le rapport, par la formulation 1 indiquée :
- DayTimeline.astro:64 « surprise haussière… EUR/USD ▲ BULL, USD ▼ BEAR, NQ neutre » : « résultat au-dessus de la prévision » et « actifs concernés : EUR/USD, NQ » (aucune flèche, aucun BULL/BEAR).
- DayTimeline.astro:67 « Bull/Bear par actif » : « Écart avec la prévision ».
- Features.astro:44 « bull ou bear pour NQ, BTC, EUR/USD » : « l'IA résume l'indicateur et l'écart avec la prévision ».
- faq.ts:30 « (haussière, baissière ou neutre) » : « (au-dessus, en ligne ou en dessous de la prévision) ».
- CoachIA.astro:65 « Conseil actionnable » : « Observation concrète ».
- Si le même vocabulaire (bull, bear, haussier, baissier, sentiment, ▲ ▼ utilisés comme direction de marché) existe ailleurs sur la landing (pages, composants, FAQ, schéma de données, meta, fichiers de contenu, llms.txt), liste-le d'abord, puis remplace-le de la même façon. Les articles de blog : tu les listes sans les modifier.
- Ajoute un test automatique (sur le modèle de eco-calendar.compliance.spec.ts) qui échoue si un texte public de la landing contient bull, bear, haussier, baissier, haussière, baissière, ou « conseil actionnable ».
- Les vidéos de démo datent du 09/11 (avant le retrait des flèches dans l'application). Ne les modifie ni ne les supprime. Liste les endroits de la landing qui les intègrent, extrais des images à intervalles réguliers (ffmpeg si disponible, sinon note que tu ne peux pas) et dis lesquelles montrent encore des flèches ou BULL/BEAR, avec le temps dans la vidéo.

## B. Application : news en séance sans direction
- live-news.component.ts:73-74 affiche « ▲ Bull / ▼ Bear » avec un sentiment fourni par la source de news. Retire ce libellé et ces flèches. Garde la source (« Source : <site> ») et tout le reste de la carte de news. Visible sans inscription via /demo : vérifie aussi ce parcours.
- Mets à jour les tests existants et ajoute un test de conformité équivalent à celui du calendrier pour ce composant (aucun bull, bear ni flèche directionnelle).
- Le bandeau de contexte (market-context-bar.component.ts:151-152) affiche des variations passées en ▲/▼ : ne le change pas, c'est un fait passé.
- Mets à jour le commentaire obsolète de eco-calendar.controller.ts:22. Ne supprime pas le type sentiment ('bull' | 'bear') de l'API.

## C. « En direct » et « temps réel » : dire ce qui est vrai
Réalité relevée dans le code : application ouverte, mises à jour quasi immédiates (WebSocket) ; application fermée, relevé automatique toutes les 15 minutes environ. La landing dit « en direct » ou « temps réel » à une dizaine d'endroits (prop-firm.astro:51-82, faq.ts:20, Hero.astro:60 et autres).
- Liste d'abord tous les endroits, puis remplace par : « En direct quand MyTradingCoach est ouvert. Application fermée, relevé automatique toutes les 15 minutes environ. » (version courte adaptée à chaque emplacement, sans changer le sens).
- Ajoute une entrée de FAQ « À quelle fréquence mes trades sont-ils synchronisés ? » avec cette réponse. Cohérence avec push-settings.component.ts:27 (15 min).
- Si une phrase de la landing promet une alerte ou une veille application fermée (Premium), lis le code et dis si elle est vraie : l'activation de la veille Tradovate en production n'est pas vérifiée (TRADOVATE_WATCH_MAX). Ne change pas ce texte : liste-le avec le fichier:ligne, Greg décidera après vérification en production.

## D. Comptes compatibles : une réponse claire
- Ajoute une entrée de FAQ « Quels comptes sont compatibles ? » : « MyTradingCoach se connecte à ton compte Tradovate en lecture seule. Ça fonctionne avec tes comptes d'évaluation et financés des prop firms qui tournent sur Tradovate, et avec tes comptes simulés ou réels. » N'écris pas de nom de prop firm au-delà de ce que le site cite déjà. Vérifie dans le code que chaque partie de la phrase est exacte (comptes réels et simulés, OAuth, lecture seule) avant de l'ajouter ; si un doute apparaît, ne l'écris pas et rapporte-le.
- Mets à jour llms.txt.ts pour qu'il reprenne la fréquence de synchronisation et cette réponse (sans changer sa phrase actuelle « aucune recommandation d'achat ou de vente, aucune prévision » : elle devient vraie une fois A et B en production).

## E. Courtiers cités sur le site (#1075)
Lis contexte-com.md et le ticket #1075. Le site cite d'autres courtiers que Tradovate et NinjaTrader, ce que la règle interdit. Applique-la UNIQUEMENT aux pages et à la FAQ de la landing concernées par #1075 : remplace les noms par une formulation générique (par exemple « import de fichiers de plusieurs courtiers et plateformes »), sans retirer la fonctionnalité. Liste séparément les articles de blog et les pages où ces noms apparaissent encore, sans les modifier. Si la règle de contexte-com.md te paraît ambiguë, arrête-toi sur ce point et pose la question dans ton rapport.

## F. Rien d'autre
Pas de changement de prix, d'offre Fondateur, d'essai, de mention NinjaTrader, de catalogue de prop firms, ni de page d'inscription.

## G. Tests et vérifications
- Lint, typecheck, tests API et app concernés, tests de la landing, build de la landing : tous verts, une suite à la fois. Le test de conformité de la landing (A) et celui des news (B) doivent passer.
- Captures avant/après (sans donnée personnelle) des sections modifiées : accueil, DayTimeline, Features, FAQ, CoachIA, news en séance (/demo), à 390 px et 1440 px. Aucun défilement horizontal.
- Recherche finale sur toute la landing et l'app publique : aucune occurrence restante de bull, bear, haussier, baissier, « conseil actionnable » (hors blog, listé à part).

## Relecture : validation à 100 % avant tout push
Lance l'agent de relecture (PROMPT-agent-relecteur.md), lecture seule sur ton diff. Il doit valider TOUS les points à 100 % : périmètre, conformité AMF, exactitude des textes par rapport au code, tests, captures, absence de changement hors périmètre. Un point non validé : tu corriges et tu relances la relecture complète. Tu ne pousses rien avant.

## Push et PR (autorisation donnée ICI, pour cette branche seulement)
Dès que le relecteur valide à 100 %, tu peux pousser fix/landing-libelles-neutres (jamais en force push) et créer la PR vers dev, jamais vers main. Les messages de commit respectent commitlint (sujet en minuscules, pas de majuscules). Corps de la PR : pourquoi, ce qui change, captures, résultat de la relecture, tests. Lignes de signature habituelles.

## Rapport final (un seul message)
1. Verdict du relecteur, point par point.
2. Fichiers modifiés et pourquoi, par section A à E.
3. Liste des occurrences listées sans modification (blog, vidéos, textes de veille Premium) avec fichier:ligne.
4. Vidéos de démo : lesquelles montrent encore des flèches ou BULL/BEAR, et à quel moment.
5. Lien de la PR, état de la CI (distingue un rouge dû au diff d'un rouge connu).
6. Ce que tu n'as pas pu faire et pourquoi.
Ne propose aucune mise en production : Greg décide.
