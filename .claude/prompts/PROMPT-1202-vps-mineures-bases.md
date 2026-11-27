# PROMPT-1202 : correctifs mineurs Postgres, Redis et docker-socket-proxy

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #1202 : VPS : contrôler les correctifs mineurs Postgres, Redis et docker-socket-proxy

Relevé par le vérificateur deploy pendant la maintenance nginx2root du 22/11.

Prod : postgres 17.11-alpine, redis 7.4.11-alpine, tecnativa/docker-socket-proxy v0.5.0 (figés dans `infra/prod/`). Ancien VPS : postgres 17-alpine, redis 7.4-alpine (tags flottants). Vérifier les mineures publiées (Postgres sort ses mineures en février, mai, août et novembre) et les appliquer dans un créneau prévu, testées d'abord en dev (une mineure Postgres impose un redémarrage du conteneur).

Vérificateurs : deploy (+ relecteur).

## Périmètre retenu

Relevé du 2026-11-27 (Docker Hub) : postgres 17.12-alpine (notes du 2026-11-12, correctifs de sécurité), redis 7.4.12-alpine (correctif de sécurité, mode cluster seulement), docker-socket-proxy v0.5.0 toujours la dernière. La PR épingle les nouveaux tags dans le dépôt et décrit la procédure ; l'application sur les VPS revient à Greg (commandes une par une, accord explicite pour la prod).
