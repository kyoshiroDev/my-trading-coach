# PROMPT-1215 : retirer le repli j:<jti> de familyOf

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #1215 : Retirer le repli j:<jti> de familyOf (jetons sans fid, expirés depuis le 21/11)

Sous-issue de #1002, relevée pendant #1014.

`familyOf` (`apps/api-mytradingcoach/src/modules/auth/refresh-rotation.ts`) dérive encore une famille `j:<jti>` pour les refresh tokens sans `fid` (émis avant #1002). Ces jetons ont tous expiré le 21/11 à 17 h 48 UTC (prod de #1002 le 14/11, refresh de 7 j) : c'est du code mort, mais la référence le décrit comme actif.

À faire :
- retirer le repli dans `familyOf`, en décidant du comportement face à un jeton sans `fid` : aujourd'hui `auth.service.ts:503` crée une famille neuve (`?? crypto.randomUUID()`) et `:642` renvoie null ;
- retirer le test unitaire « jeton d'avant #1002 (jti sans famille) » de `auth.service.spec.ts` ;
- mettre à jour la ligne correspondante de `.claude/reference/commun/connexion-google.md` (« Jeton sans fid (d'avant #1002) : famille j:<jti> »).

## Décision prise pour le comportement

Tout refresh émis depuis #1002 (prod le 14/11, 17 h 48 UTC) porte un `fid` et un `jti` (`generateTokens`). Un jeton sans `fid` ou sans `jti` est donc forcément d'avant, et expiré depuis le 21/11. Il est refusé en 401, comme un jeton expiré. À la déconnexion, un jeton sans `fid` n'a rien à révoquer.
