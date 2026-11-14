# PROMPT — e-mail insensible à la casse (#999, lot 1e de l'audit #994)

## Demande de Greg (2026-11-14, texte exact)

> on peut attaquer quoi en correctif dans bug en cours faudrait en corriger un maximum a chaque fois tu valide avec l'agent de relecture une fois vailider a 100% tu push et ouvre un pr vers dev et tu passe au suivant preil toujours avec le relecteur qui valide tous etc

> je t'autorise à lire le comptage en base prod pour #999 et le reste des cporrectifs pour cette session

## Règle du ticket #999 (sous-issue de #994)

> En attente du comptage en lecture seule de Greg (majuscules et doublons). Doublons = 0 : minuscules à l'écriture et recherche insensible à la casse. Doublons > 0 : ticket à part, décision de Greg.

## Comptage prod (lecture seule, `mtc_readonly`, 2026-11-14)

- 22 comptes ; 2 adresses avec majuscules ; 0 espace autour ; **0 doublon** (`lower(btrim(email))`).
- `DeletedAccount` : 0 adresse avec majuscules.

→ Doublons = 0 : correctif direct.
