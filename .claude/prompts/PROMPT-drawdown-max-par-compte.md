# PROMPT : drawdown max juste (par trade, par compte) et vocabulaire clair

Branche : fix/drawdown-max-par-trade, créée depuis origin/dev à jour. Tu travailles lentement, tu prouves chaque point, tu t'arrêtes au moindre doute.

## Règles absolues
- Aucun secret affiché ou écrit. Aucune action sur le VPS, Stripe, la prod ou une base distante. Base locale de test uniquement.
- Pas de push sans mon « OK push ». Je crée moi-même les PR (vers dev).
- Une seule suite lourde à la fois, 2 workers maximum.
- Pas de tiret cadratin dans les textes visibles. Aucune promesse de gain. Vocabulaire neutre (AMF) : pas de « rentable », pas de conseil d'achat ou de vente.
- Périmètre strict : les points ci-dessous. Tout le reste, tu le signales sans le toucher.

## Le problème (constats de l'utilisateur, captures du 10 et 11/11)
1. Sur le dashboard en vue « Tous les comptes », la carte « Drawdown max » (-$1,000.50 sur 30 jours) additionne tous les comptes dans UNE seule série : `summaryTotals` (analytics.sql.ts) fait un seul cumul trié par date sur tous les trades du filtre. Ce chiffre n'est le drawdown d'aucun compte réel. Les règles des prop firms s'appliquent compte par compte : le gain du compte A efface à tort la perte du compte B.
2. Écart de définition avec Lucid (compte LucidFlex) : le « DRAWDOWN » affiché par Lucid est la MARGE restante (solde moins seuil de liquidation), alors que le « DRAWDOWN MAX $2,000 » de MTC est la TAILLE de la règle. Les chiffres étaient cohérents (marge MTC 52,254 - 49,064 = 3,190, identique à Lucid) mais le vocabulaire prête à confusion.
3. Un drawdown max calculé sur les résultats de fin de journée (-88.50) au lieu de trade par trade (-535.50, « PNL LOW » chez Lucid) a été constaté. Il est possible que ce point soit déjà corrigé sur dev.
4. P&L net 1,907.80 et capital 51,901.40 : il manque 6.40 par rapport à 50,000 + 1,907.80. Origine inconnue (frais ? arrondis ?).

## Étape 0 : état réel (lecture seule, rapporte avant de coder)
- Le libellé « trades clôturés · sur 30 jours » n'existe pas dans la version du 07/11. Retrouve où il vit sur dev.
- Pour chaque point 1 à 3 : dis s'il est déjà traité sur origin/dev, avec le fichier et la ligne.
- Liste tous les endroits qui calculent un drawdown max (analytics.sql.ts, analytics.service.ts, session-totals.ts, prop-risk-context.ts, account-rules.ts, composant perf-chart, debrief, ai-insights) et dis lesquels mélangent plusieurs comptes.
- Arrête-toi et rapporte si l'état réel contredit ce prompt.

## Étape 1 : correction (seulement ce que l'étape 0 a montré non traité)
A. Drawdown max PAR COMPTE, trade par trade
- Dans `summaryTotals`, cumul et plus haut calculés avec PARTITION BY accountId (jamais une série mélangée), trades triés par tradedAt puis id.
- Le plus haut part de 0 (solde de départ), comme aujourd'hui.
- Vue d'un seul compte : résultat inchangé (test de non-régression sur les valeurs actuelles).

B. Vue « Tous les comptes »
- Le chiffre affiché est le PIRE drawdown parmi les comptes inclus, avec le nom du compte concerné (« sur le compte X »).
- Interdit : une somme ou un cumul mélangé présenté comme un drawdown.
- La courbe de la carte suit la même logique (courbe du compte le plus touché), ou est masquée en vue multi-comptes avec un libellé clair. Choisis l'option la plus simple et dis laquelle.
- Les comptes archivés et échoués restent exclus tant que la case « Inclure les comptes échoués et archivés » est décochée.

C. Vocabulaire (textes visibles, infobulles comprises)
- « Drawdown max » : plus forte baisse depuis un sommet, trade par trade, sur la période.
- « Marge de drawdown » (ou « Marge avant liquidation ») : distance restante entre le solde et le seuil de la règle du compte. C'est ce que Lucid appelle « DRAWDOWN ».
- « Règle de drawdown » : la taille de la règle (ex. 2 000 $). Ne plus l'appeler « Drawdown max ».
- Ajoute une infobulle courte sur chaque libellé. Reste cohérent entre dashboard, Mes comptes et fiche compte. Ne change aucun chiffre calculé pour ce point, uniquement les libellés.

D. Écart de 6.40 : ENQUÊTE SEULE, aucune correction
- Reproduis avec les données de test : P&L net (somme des trades) contre capital affiché.
- Liste les sources possibles (frais, commissions, arrondis, trades hors période, payouts) et dis laquelle explique l'écart, avec la preuve. Si tu ne peux pas conclure, dis ce qu'il faudrait mesurer.

## Tests obligatoires
1. Deux comptes : A gagne +500 pendant que B perd -400 (même période, trades entrelacés). Vue tous comptes : drawdown = 400 sur B, pas 0 et pas 100.
2. Un seul compte : valeurs identiques à avant (non-régression).
3. Trade par trade et non fin de journée : un compte qui monte puis redescend dans la même journée, drawdown trade par trade supérieur à celui de fin de journée.
4. Compte archivé exclu puis inclus avec la case.
5. Aucun compte / aucun trade : 0, pas d'erreur.
6. Libellés : test sur les textes (pas de « Drawdown max » pour désigner la règle).

## Vérifications finales
- Lint, typecheck, tests API et app concernés, vert. Une suite lourde à la fois, 2 workers.
- Regarde l'écran dashboard en local avec des données à deux comptes (capture sans donnée personnelle).

## Rapport final (un seul message)
1. État de l'étape 0 (traité ou non, par point).
2. Fichiers modifiés et pourquoi, en quelques lignes.
3. Résultat des tests (nombre, vert).
4. Conclusion sur l'écart de 6.40.
5. Ce que tu n'as pas touché mais qui mérite un ticket.
Ne pousse rien. Attends mon « OK push ».

---

## Compléments (2026-11-11, après l'étape 0, réponses du relecteur)
- Branche renommée `fix/drawdown-max-par-compte` : l'ancienne `fix/drawdown-max-par-trade` existe encore côté distant (déjà mergée, #913/#915), la réutiliser imposerait un push forcé.
- Point 3 déjà traité sur dev (source unique `libs/shared/src/max-drawdown.ts`) ; test 3 gardé comme non-régression.
- Point 1 : `summaryTotals` ne calcule plus le drawdown. Correction appliquée via `closedTradeNets` (+ accountId) et un calcul par compte dans `max-drawdown.ts` (pas de PARTITION BY SQL, pour garder une source unique). Trades sans compte = leur propre groupe. L'API renvoie l'id du compte, le front résout le nom.
- Carte drawdown de Statistiques incluse (même calcul API). Courbe masquée en vue multi-comptes.
- Libellés : « Marge avant le plancher » (contexte-com.md) pour la marge, « Règle de drawdown » pour la taille de la règle.
- Débrief : le champ id de compte ajouté au résumé ne part ni à l'IA ni dans `WeeklyDebrief.stats`.
