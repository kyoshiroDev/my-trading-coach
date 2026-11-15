# PROMPT — Profil : « modifier l'e-mail » en 400 (#1020, sous-issue de #994)

## Contexte

Trouvé par le relecteur pendant #999 : `saveEmail` du Profil envoie `{ email }` à `PATCH /users/me` ; `UpdateMeDto` (API) n'a que `name`, `forbidNonWhitelisted` → 400. Personne ne peut changer son adresse.

Recommandation du relecteur : retirer le bouton (petit correctif front). Alternative : construire le changement d'e-mail complet (ticket à part).

## Décision de Greg (2026-11-15, texte exact)

> suit les recommandation du relecteur
