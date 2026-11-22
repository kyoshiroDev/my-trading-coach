> Pas de prompt de Greg : texte du ticket #1182, relevé par l'agent design.

# Admin Tirages : mise en page de l'historique (retours à la ligne, 390 px, panneau étiré)

Relevé par l'agent design pendant la relecture du lot B (#1158), hérité du lot A (onglet admin « Tirages », #1150) ; à traiter au lot C, qui touche cet historique :
- à 1440 px, colonnes Mois et Lot de l'historique qui passent à la ligne (« 2027-/02 », « 1/mois ») → `white-space: nowrap` ;
- à 390 px, carte de l'historique : e-mail du gagnant centré alors que le nom est aligné à droite ; cellule Message en deux colonnes (texte et boutons) ;
- panneau Historique étiré jusqu'en bas de l'écran avec une seule ligne.

Fichiers : `apps/admin-mytradingcoach/src/app/features/giveaway/giveaway.component.{html,css}`.

