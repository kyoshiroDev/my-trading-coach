attaque le #1282

Texte de l'issue #1282 :

## Constat

Au redémarrage de Traefik sur le VPS prod (v3.7.19), le 2026-11-25 à 18:05 (#1273), le journal affiche deux avertissements `WRN`. Ils ne viennent pas de #1273 : la configuration statique ne règle aucune de ces deux options, ni avant ni après ce ticket.

1. **Caractères encodés dans le chemin** : « Traefik can reject some encoded characters in the request path. When your backend is not fully compliant with RFC 3986, it is recommended to set these options to `false` to avoid split-view situation. » Le message renvoie à la doc de migration v3, section *encoded characters configuration default values*.
2. **`aliasHeadersStrategy` non configuré**, signalé pour chacun des entrypoints `ping`, `web` et `websecure`. Traefik transmet tels quels les en-têtes dont le nom imite un autre (`X_Auth_User` ou `X.Auth.User` pour `X-Auth-User`). Un backend qui dérive des noms de variables des noms d'en-têtes peut alors lire un en-tête usurpé. Traefik conseille `delete` ou `reject` sur les entrypoints concernés.

## À faire

- Lire la doc Traefik de la version déployée pour ces deux options : noms exacts, valeurs par défaut, emplacement (entrypoint ou global).
- Évaluer l'effet sur MTC :
  - API NestJS derrière `api-prod-secure` : un backend Node ne dérive pas de variables des noms d'en-têtes, risque a priori faible, à confirmer ;
  - app statique nginx (`app-prod`) ;
  - routes qui reçoivent des caractères encodés dans le chemin (identifiants, webhooks Stripe, callbacks OAuth).
- Choisir les valeurs, les poser dans `infra/prod/traefik/traefik.yml` (copie de référence), puis les appliquer sur le serveur et vérifier que les avertissements ont disparu.

## Points d'attention

- Les entrypoints `web` et `websecure` sont **partagés avec un autre projet hébergé** sur le VPS (#1273, règle 12 de `deploy.md`). Un réglage posé sur l'entrypoint s'applique aussi à cet autre projet : à décider en connaissance de cause, ou à poser autrement si Traefik le permet.
- Ancien VPS (dev, beta, landing, admin) : Traefik v2.11, configuration hors dépôt ; ces avertissements sont propres à la v3. À vérifier séparément.
- Domaines : deploy et security.

