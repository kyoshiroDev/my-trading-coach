# PROMPT — #1000 séances : trades d'autres journées rattachés à la séance ouverte

Demande de Greg (14/11), texte exact :

> oui prends #1000

Contexte (proposé par Claude juste avant, accepté par Greg) : « #1000 : des séances déjà en base
contiennent des trades d'autres journées, ce qui fausse leurs totaux et leur émotion. On suivrait le
même modèle que les réparations précédentes : comptage en lecture seule, simulation, puis réparation
réelle lancée par toi. » Tout passe par le relecteur ; à 100 % : push et PR vers `dev`.

Ticket #1000 (suite de N1, audit #994, lot 1b #996) : « le correctif empêche les nouveaux cas. Les
séances déjà en base peuvent porter des trades d'autres journées (totaux de séance et émotion
effective faussés). Modèle #780/#947 : comptage en lecture seule, simulation par défaut, réel lancé
par Greg. »
