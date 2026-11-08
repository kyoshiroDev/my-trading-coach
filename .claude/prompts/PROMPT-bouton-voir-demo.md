# PROMPT — Bouton « Voir la démo » de /prop-firm plus visible + cartes de l'aperçu centrées

> **Contexte (08/11).** En haut de `/prop-firm`, « Voir la démo » est un simple lien souligné à côté du bouton bleu « Commencer gratuitement ». Il ne donne pas envie de cliquer. On veut un vrai bouton secondaire, sans voler la place du bouton principal : la démo fait déjà beaucoup d'ouvertures, l'inscription doit rester l'action n°1.
>
> **Uniquement du style.** Contenu, URL, lien affilié NinjaTrader et événements de suivi de `/prop-firm` ne changent pas.
>
> Correctif : branche `fix/bouton-voir-demo` depuis `origin/dev` à jour (elle contient déjà `fix/accueil-vers-prop-firm`), dans un worktree séparé.

## Règles de travail
- Lis `astro.md` et `design.md`.
- Tokens de la landing uniquement, aucune couleur en dur. CSS dans les fichiers de style du composant.
- `pnpm` uniquement. Un commit `fix(landing):`. **Aucun push sans mon « OK push ».**

## Le bouton
- Remplace le lien souligné « Voir la démo » du haut de `/prop-firm` par un **bouton secondaire** :
  - même hauteur, même arrondi et même taille de texte que « Commencer gratuitement » ;
  - fond transparent, bordure de 1,5 à 2 px en bleu de la landing, texte clair ;
  - icône lecture (▶) en SVG avant le texte, alignée verticalement ;
  - texte : « Voir la démo ».
- Sous le bouton (ou sous la paire de boutons), une mention discrète en mono : « Sans compte · 1 min ». Elle ne doit pas faire doublon avec la ligne « Gratuit, sans carte bancaire · 14 jours de Premium offerts… » : place-la proprement, ou intègre « Sans compte » au bouton si c'est plus net. Montre-moi la version choisie.
- Survol : bordure plus claire et léger fond bleuté. Focus clavier visible. Contraste AA.
- **Mobile (< 640 px)** : les deux boutons l'un sous l'autre, en pleine largeur, « Commencer gratuitement » en premier.
- « Commencer gratuitement » ne change pas (taille, couleur, position).
- Garde exactement le même lien et le même événement de suivi que l'actuel « Voir la démo ».
- Si un autre lien « Voir la démo » existe plus bas sur `/prop-firm`, applique-lui le même style. Ne touche pas à `/accueil`.

## Les 3 petites cartes de l'aperçu « Éval Apex 50K »
- Dans l'aperçu à droite du titre (carte « Éval Apex 50K · En séance »), les trois petites cartes « Objectif restant », « Perte du jour » et « Trades du jour » ont leur texte aligné à gauche. **Centre horizontalement le libellé et la valeur** de chacune, avec un espacement vertical régulier.
- Les trois cartes gardent la même largeur et la même hauteur, y compris quand une valeur est plus longue (« 1 240 $ ») ou négative (« -520 $ »). Pas de retour à la ligne dans les valeurs.
- Ne change pas le haut de la carte (« Éval Apex 50K », « Il te reste avant la limite », « 480 $ », la barre) : il reste aligné à gauche. Ne change ni les chiffres de démonstration, ni les couleurs, ni la mention « Exemple avec des données de démonstration ».
- Si ce même composant d'aperçu est utilisé ailleurs (page d'inscription en deux colonnes, `/accueil`), applique le centrage partout où il apparaît, et liste les endroits.
- Commit séparé `fix(landing):` (ou `fix(app):` si le composant est aussi dans l'app).

## Vérifications (arrêt pour captures)
- Captures du haut de `/prop-firm` à 390, 768 et 1440 px, plus l'état survol à 1440 px. Les trois petites cartes doivent être bien visibles et centrées sur chaque capture.
- Le clic ouvre toujours la démo et l'événement de suivi part toujours (vérifie avec une fausse API locale, rien vers la prod).
- Build, `astro check` et lint de la landing au vert.
- **Stop. Aucun push sans mon « OK push ».**
