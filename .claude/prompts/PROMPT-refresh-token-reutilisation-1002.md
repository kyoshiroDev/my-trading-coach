# PROMPT — #1002 refresh token : l'ancien jeton reste valide après rotation

Demande de Greg (14/11), texte exact :

> oui prends #1002

Contexte (choix proposé par Claude, accepté par Greg dans le même échange) : « #1002, le jeton de
reconnexion qui reste valide après renouvellement. Il faut savoir repérer qu'un ancien jeton est
réutilisé, sans déconnecter à tort quelqu'un qui a plusieurs onglets ouverts. Le travail est
entièrement dans le code, sans rien en prod. » Tout passe par le relecteur ; à 100 % : push et PR
vers `dev`.

Ticket #1002 (suite de S2, audit #994) : « la rotation n'invalide pas l'ancien refresh. Détection de
réutilisation à concevoir sans déconnecter à tort les utilisateurs multi-onglets. »
