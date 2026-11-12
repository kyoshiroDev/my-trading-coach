# PROMPT : page d'inscription sans scroll inutile (desktop)

Branche : fix/inscription-sans-scroll. Tu travailles lentement, tu prouves chaque point avec des captures, tu t'arrêtes au moindre doute.

## Prérequis (lecture seule, avant de coder)
La branche fix/mobile-premier-pas-mots-de-passe (mots de passe empilés) doit être mergée dans origin/dev. Vérifie-le.
- Si oui : crée ta branche depuis origin/dev à jour.
- Si non : STOP et rapporte. Je déciderai de l'ordre, ne contourne pas.

## Règles absolues
- Périmètre strict : mise en page et textes légaux de la page d'inscription (deux colonnes). Aucun changement de logique, de validation, d'API, de champ, de nom de champ, de remplissage automatique, d'ordre de tabulation. Le reste, tu le signales sans le toucher.
- Aucun secret affiché ou écrit. Aucune action sur le VPS, Stripe, la prod. Données locales seulement.
- Une seule suite lourde à la fois, 2 workers maximum.
- Pas de tiret cadratin dans les textes visibles. Aucune promesse de gain.

## Constat
Sur desktop (viewport environ 960 px de haut), la page d'inscription défile : la carte du formulaire fait environ 880 px et démarre à 42 px du haut, la page dépasse d'environ 175 px. Il faut gagner environ 180 px sur la carte sans rien retirer d'essentiel. Une seconde barre de défilement fine apparaît aussi à droite de la page (double scroll probable).

## Corrections (dans cet ordre)
1. Fusionner les deux phrases légales en une seule.
   - Aujourd'hui : « En continuant avec Google, tu acceptes les CGU et confirmes avoir 18 ans ou plus » sous le bouton Google, et « En créant ton compte, tu acceptes les CGU et confirmes avoir 18 ans ou plus. Tes données : politique de confidentialité » sous le bouton principal.
   - Cible : une seule phrase, placée sous le bouton principal, qui couvre les deux parcours, par exemple « En continuant (Google ou e-mail), tu acceptes les CGU et confirmes avoir 18 ans ou plus. Tes données : politique de confidentialité. » Garde les liens CGU et politique de confidentialité fonctionnels.
   - Contrainte légale : la phrase doit rester visible AVANT l'action pour les deux parcours (Google et e-mail), sans clic supplémentaire. Si la disposition ne le permet pas, ne fusionne pas et dis-le.
2. Resserrer les espaces : hauteur des champs d'environ 42 à 38 px, espace entre champs réduit d'environ 6 px, marge haute de la carte réduite, case « Recevoir les offres et nouveautés » sur 2 lignes au lieu de 3 (texte inchangé, seule la mise en page change). Cibles tactiles et lisibilité préservées (pas de police sous 12 px, cible de clic d'au moins 36 px de haut sur desktop).
3. Ligne « 14 jours de Premium offerts · sans carte · puis gratuit, sans engagement » : la remonter ou la fusionner près du bouton principal pour gagner environ 20 px. Texte inchangé.
4. Espacement dépendant de la hauteur de l'écran : `@media (max-height: 1000px)` (ou `clamp()` en `vh`) qui réduit marges et hauteurs de champs sur écran bas. À 960 px de haut et plus, aucun scroll. En dessous, le scroll reste possible et doit être propre.
5. Double scroll : identifie pourquoi une seconde barre apparaît à droite. Il ne doit rester qu'un seul scroll, celui de la page (pas de conteneur interne en plus). Si la cause est ailleurs que dans cette page, liste-la sans la corriger.

## À NE PAS faire sans mon accord
- Ne retire pas le bandeau en bas de la carte « LECTURE SEULE, AUCUN ORDRE PASSÉ · HÉBERGÉ EN FRANCE · RÉFÉRENCÉ DANS L'ÉCOSYSTÈME NINJATRADER ». Il contient la mention d'affiliation NinjaTrader, qui doit rester visible. Tu peux seulement proposer, dans le rapport, une variante plus compacte (par exemple sur une seule ligne), sans l'appliquer.
- Ne touche ni à la colonne de gauche (titre, liste, carte de démonstration), ni au parcours mobile (déjà traité dans l'autre branche).

## Tests et preuves
- Captures avant/après sans donnée personnelle : 1920x960, 1920x1080, 1440x900, 1366x768, et mobile 390 px (non-régression des mots de passe empilés).
- Aucun scroll vertical à 960 px de haut et plus. À 768 px de haut : scroll propre, bouton principal atteignable.
- document.scrollHeight <= hauteur de la fenêtre à 1920x960 et 1920x1080 (mesure en console, à rapporter).
- Test d'inscription existant vert. Lint, typecheck, tests de l'app concernés, verts, une suite à la fois.
- Vérifie que le bouton Google, la case newsletter, le lien « Explorer la démo, sans compte » et « Se connecter » restent fonctionnels (clic, focus clavier).

## Relecture : validation à 100 % avant tout push
Lance l'agent de relecture (PROMPT-agent-relecteur.md) en lecture seule sur ton diff. Il doit valider TOUS les points à 100 % : corrections 1 à 5, captures, mesures, absence de changement hors périmètre, texte légal visible avant l'action, mention NinjaTrader conservée, tests, lint. Un seul point non validé : tu corriges et tu relances la relecture complète jusqu'à 100 %. Tu ne pousses rien avant.

## Push et PR (autorisation donnée ICI, pour cette branche seulement)
Dès que le relecteur valide à 100 %, tu peux pousser fix/inscription-sans-scroll et créer la PR vers dev (jamais vers main). Aucun merge, aucune autre branche. Corps de la PR : pourquoi, ce qui change, captures avant/après, mesures de scrollHeight, résultat de la relecture, tests. Termine par les lignes de signature habituelles.

## Rapport final (un seul message)
1. Verdict du relecteur, point par point.
2. Fichiers modifiés et pourquoi.
3. Gain de hauteur obtenu (px) par correction et total.
4. Cause du double scroll.
5. Proposition éventuelle pour le bandeau du bas (non appliquée).
6. Lien de la PR vers dev et état de la CI (distingue un rouge dû au diff d'un rouge dû aux tests à date figée connus).

---

Complément de Greg (message d'envoi) : « lance au verificateur ensuite et temps qu'il valide pas tu modifie une fois qu'il valide a 100% tu push et créer la PR vers dev »
