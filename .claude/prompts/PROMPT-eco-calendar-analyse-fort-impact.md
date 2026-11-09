MISSION : l'analyse IA des annonces économiques à 3 étoiles (fort impact) ne couvre pas ce qu'elle devrait. Branche fix/eco-calendar-analyse-fort-impact depuis origin/dev à jour, worktree séparé, pnpm, une seule suite lourde à la fois (2 workers), base locale dédiée, tout test qui fixe une date fige l'horloge, commit conventionnel, aucune prod, aucune migration sans me la montrer, aucun push sans mon "OK push" (c'est moi qui ouvre la PR vers dev). Aucun appel réel à l'IA ni à FMP dans les tests.

CONSTAT (lu dans le code, à confirmer par les données) :
- Analyse d'un événement publié : uniquement à la demande (clic sur le bouton IA, POST /eco-calendar/analyze-result), jamais automatique.
- isReleased = actual !== null : les événements sans résultat chiffré (discours, conférences de presse, minutes) ne sont jamais "publiés", donc jamais analysés, alors qu'eco-calendar.impact.ts les classe en fort impact (GOVERNORS).
- Polling des résultats : eco-calendar.cron.ts, toutes les minutes de 8 h à 17 h 59 Paris du lundi au vendredi, puis un rafraîchissement final à 18 h 30. La décision de la Fed tombe à 20 h Paris (conférence à 20 h 30) : hors fenêtre, son résultat n'est donc jamais enregistré, ni analysé. Les événements asiatiques de nuit sont aussi hors fenêtre.
- ai.service.ts analyzeEcoResult : actual ?? 0 et estimate ?? 0. Une prévision absente devient 0 et fausse la "surprise".
- L'analyse du matin est un seul paragraphe pour tous les événements, par (date, signature d'actifs).

ÉTAPE 0 : MESURE (lecture seule, avant tout code). Donne-moi la requête SELECT exacte à valider (rôle mtc_readonly, résultats agrégés, aucune donnée perso), puis les chiffres sur 30 jours : événements à fort impact par heure de Paris, combien ont un actual non nul, combien n'en ont pas alors que l'heure est passée, combien ont une prévision nulle, nombre de lignes de EcoAnalysisCache par jour, appels IA de la fonction eco_calendar par jour. Si tu ne peux pas accéder aux données, dis-le et travaille sur le code.

ÉTAPE 1 : couverture des heures (commit séparé)
- Remplace la fenêtre fixe par une planification autour de l'heure de chaque annonce attendue : à partir de l'heure prévue, interroge FMP toutes les 15 à 30 secondes jusqu'à ce que le résultat apparaisse, avec un maximum de 15 minutes, et ne sollicite pas FMP en dehors de ces fenêtres. Couvre toutes les heures de la séance (soir et nuit compris) du dimanche soir au vendredi soir. Respecte les limites de requêtes du plan FMP utilisé (lis la doc officielle et le code) et dis combien d'appels par jour cela représente avant et après.
- Rattrapage : le matin (6 h), resynchronise aussi les événements de la veille restés sans résultat. Vérifie que le rafraîchissement de 18 h 30 ne supprime rien d'utile.
- Tests avec horloge figée : une annonce à 20 h 00 Paris est détectée et stockée ; une annonce de nuit aussi ; aucune requête hors fenêtre ; passage à l'heure d'été et à l'heure d'hiver.

ÉTAPE 2 : analyse automatique des événements chiffrés à fort impact (commit séparé)
- Dès qu'un événement à fort impact est publié, génère son analyse côté serveur une seule fois par (événement, signature d'actifs) et conserve-la (même cache et même clé que analyzeReleasedEvent, ou un stockage en base si plus sûr). L'utilisateur la voit sans cliquer. Le clic existant continue de fonctionner et de réutiliser le cache.
- Corrige actual ?? 0 et estimate ?? 0 : prévision absente = "pas de consensus", aucune surprise calculée. Aucun appel au modèle avec une valeur inventée.
- Garde-fous de coût : un seul appel par (événement, signature), plafond quotidien configurable, compteur dans les journaux sans contenu. Modèle rapide comme aujourd'hui.
- Tests : une seule génération même avec 50 utilisateurs de la même signature ; échec de l'IA = repli propre, nouvel essai plus tard ; aucun appel hors production (comportement actuel conservé).

ÉTAPE 3 : événements sans résultat chiffré (commit séparé)
- Pour les discours, conférences de presse et minutes à fort impact : ne prétends pas analyser ce qui a été dit (aucun texte disponible). Affiche un statut honnête et neutre : "Intervention prévue à HH:MM, volatilité possible. Pas de résultat chiffré, pas d'analyse automatique." Dis-moi si une source de texte existe, sans l'ajouter.
- Ces événements ne doivent plus rester indéfiniment "non publiés" : ajoute un état "passé" distinct.

ÉTAPE 4 : briefing avant l'annonce (commit séparé, optionnel si le temps manque : dis-le)
- Pour chaque événement à fort impact du jour, une ligne neutre et factuelle : prévision, précédent, heure, actifs concernés pour CE trader. Aucune direction, aucun conseil. Calculé côté serveur, mutualisé par signature d'actifs.

ÉTAPE 5 : CONFORMITÉ (commit TOUT À FAIT séparé, que je pourrai écarter)
- Inventaire de ce que l'IA produit aujourd'hui : sentiment bull/bear par actif, flèches par devise, "1 conseil actionnable concret". Propose une version factuelle : écart prévision / résultat calculé en code (au-dessus, en ligne, en dessous), interprétation en langage simple sans direction ni conseil, mêmes règles de rédaction que #881 (pas de consigne d'achat ou de vente, pas de prévision, pas de promesse). Applique-la dans ce commit seul, avec le test qui échoue si les termes proscrits reviennent. Ne touche pas aux données de démo figées sans me le dire.

RAPPORT : chiffres de l'étape 0, ce qui est corrigé, nombre d'appels FMP et IA avant et après, tests, commandes et résultats, état de la branche, ce que je dois vérifier à la main sur dev (indique un événement du soir réel à surveiller), écarts avec ce prompt. Aucun push avant mon "OK push".
