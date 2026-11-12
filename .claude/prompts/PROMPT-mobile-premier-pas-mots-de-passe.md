# PROMPT : deux corrections d'affichage (mobile : carte « Fais ton premier pas », inscription : mots de passe)

Branche : fix/mobile-premier-pas-mots-de-passe, créée depuis origin/dev à jour. Tu travailles lentement, tu prouves chaque point avec des captures, tu t'arrêtes au moindre doute.

## Règles absolues
- Périmètre strict : ces deux corrections d'affichage, CSS/HTML seulement. Aucun changement de logique, de validation, d'API, de texte métier ni de chiffre. Tout le reste, tu le signales sans le toucher.
- Aucun secret affiché ou écrit. Aucune action sur le VPS, Stripe, la prod. Base et données locales uniquement.
- Une seule suite lourde à la fois, 2 workers maximum.
- Pas de tiret cadratin dans les textes visibles.

## Correction 1 : carte « Fais ton premier pas » débordante sur mobile
Constat (capture iPhone, dashboard d'un compte sans trade, vue « Tous les comptes ») : dans la carte « Fais ton premier pas », le bouton « Importer mes trades » dépasse du bord droit de l'écran et du cadre de la carte (texte coupé). Le bouton « Enregistrer mon premier trade » est sur la même ligne.
À faire :
- Sur petit écran, les deux boutons passent l'un sous l'autre, pleine largeur de la carte (ou retour à la ligne propre), sans jamais dépasser la carte ni créer de défilement horizontal de la page.
- Texte des boutons non tronqué. Si un libellé est trop long, il passe sur deux lignes plutôt que de déborder.
- Sur desktop : rendu inchangé (comparer avant/après).
- Cherche les autres cartes ou barres de boutons du dashboard, de la page Journal et des écrans vides qui utilisent la même mise en page (rangée de boutons sans retour à la ligne). Corrige-les seulement si elles débordent réellement à 360 px, sinon liste-les dans le rapport.

## Correction 2 : formulaire d'inscription, mots de passe l'un sous l'autre
Constat : sur le formulaire d'enregistrement, les champs « mot de passe » et « confirmation du mot de passe » sont côte à côte, ce qui rend mal.
À faire :
- Les deux champs sont empilés (mot de passe, puis confirmation en dessous), pleine largeur, avec le même espacement que les autres champs du formulaire.
- Mobile obligatoirement. Sur desktop, empile-les aussi pour rester cohérent avec les autres champs (page d'inscription deux colonnes : les deux colonnes de la page, texte et formulaire, restent inchangées, seuls les deux champs mot de passe s'empilent).
- Ne change rien d'autre : noms et attributs des champs, remplissage automatique du navigateur, aide à la saisie du mot de passe, indicateur de force, messages d'erreur, ordre de tabulation (mot de passe puis confirmation), bouton d'œil afficher/masquer, validation.
- Vérifie que les messages d'erreur sous chaque champ ne cassent pas la mise en page une fois empilés.
- Cherche les autres formulaires qui ont le même couple de champs côte à côte (réinitialisation du mot de passe, changement de mot de passe dans le profil, etc.) et dis lesquels. Corrige-les seulement s'ils présentent le même défaut visible, sinon liste-les.

## Tests et preuves
- Captures avant/après sans donnée personnelle, aux largeurs 360, 375, 390, 414 px et en desktop (1280 px), pour les deux écrans. Aucun défilement horizontal de la page (vérifier document.scrollWidth <= largeur de la fenêtre).
- Clavier mobile ouvert ou simulé : les champs restent atteignables.
- Test automatisé quand c'est simple et utile (par exemple le test existant du formulaire d'inscription qui doit rester vert). N'ajoute pas de test fragile aux pixels.
- Lint, typecheck et tests de l'app concernés, verts, une suite à la fois.

## Relecture : validation à 100 % avant tout push
Quand tu as fini, lance l'agent de relecture (PROMPT-agent-relecteur.md) en lecture seule sur ton diff. Règles :
- Le relecteur doit valider TOUS les points à 100 % : les deux corrections, les captures, l'absence de changement hors périmètre, les tests et le lint. Un seul point non validé = tu corriges et tu relances la relecture complète, jusqu'à 100 %.
- Tu ne contournes jamais un refus du relecteur et tu ne le contestes pas sans preuve.
- Tu ne pousses rien avant ce 100 %.

## Push et PR (autorisation donnée ICI, pour cette branche seulement)
Dès que le relecteur valide à 100 %, tu as mon autorisation de : pousser fix/mobile-premier-pas-mots-de-passe, puis créer la PR vers dev (jamais vers main). Aucune autre branche, aucun merge, aucune promotion vers main. Corps de la PR : pourquoi, ce qui change, captures avant/après, résultat de la relecture (100 %), tests. Termine par les lignes de signature habituelles.

## Rapport final (un seul message)
1. Verdict du relecteur (100 % ou non, point par point).
2. Fichiers modifiés et pourquoi, en quelques lignes.
3. Captures avant/après (largeurs listées).
4. Autres écrans trouvés avec le même défaut (corrigés ou listés).
5. Lien de la PR vers dev et état de la CI. Si la CI est rouge, dis si c'est à cause de ce diff ou des tests à date figée déjà connus (ne corrige pas ces derniers ici).
