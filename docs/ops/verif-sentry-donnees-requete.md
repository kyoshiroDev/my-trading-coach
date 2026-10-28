# Vérifier ce que l'API envoie à Sentry (#746)

But : provoquer une vraie 500 avec des valeurs **fictives** et lire l'événement reçu par Sentry.
Le correctif retire le corps, les cookies, la query string et les en-têtes `authorization` /
`cookie` ; il garde l'erreur, la méthode, le chemin, les en-têtes techniques et `user.id`.

Les tests (`src/common/sentry/sentry-options.spec.ts`) le prouvent déjà avec le vrai SDK et un
transport en mémoire. Cette procédure vérifie le dernier maillon : ce que Sentry **stocke**.

## Pourquoi en local et pas sur l'API dev déployée

Aucune route de l'API ne garantit une 500 sans changer le code, et l'API ne démarre pas sans
base (`PrismaService.onModuleInit` → `$connect`). En local, on démarre l'API normalement puis on
coupe le Postgres local : la requête suivante qui lit la base sort en 500 (`INTERNAL`), passe
par `HttpExceptionFilter` et part à Sentry comme en prod.

## Prérequis

- Un checkout de la branche du correctif (ou de `dev` une fois mergé) avec le `.env` local habituel.
- Postgres et Redis locaux lancés (`docker compose up -d postgres redis`).
- Le DSN du projet Sentry de l'API (page « Client Keys » du projet). **Il ne va dans aucun
  fichier** : on le passe seulement dans la commande, le temps du test.

## Étapes

1. Démarrer l'API avec Sentry actif, dans un environnement Sentry dédié pour retrouver
   l'événement sans bruit :

   ```bash
   SENTRY_DSN='<dsn collé ici, pas dans un fichier>' SENTRY_ENVIRONMENT=verif-746 \
     PORT=3001 pnpm nx serve api-mytradingcoach
   ```

2. Attendre « Nest application successfully started », puis couper la base locale :

   ```bash
   docker compose stop postgres
   ```

3. Envoyer une requête de connexion avec des valeurs fictives partout :

   ```bash
   curl -s -X POST 'http://localhost:3001/api/auth/login?token=TOKEN-FICTIF-746' \
     -H 'Content-Type: application/json' \
     -H 'Authorization: Bearer JWT-FICTIF-746' \
     -H 'Cookie: refresh_token=REFRESH-FICTIF-746' \
     -d '{"email":"verif-746@exemple.invalid","password":"MOT-DE-PASSE-FICTIF-746"}'
   ```

   Réponse attendue : `{"statusCode":500,"code":"INTERNAL",…}`. Une 401 veut dire que la base
   répondait encore (refaire l'étape 2). Une 429 : attendre une minute (limite de débit du login).

4. Relancer la base et arrêter l'API : `docker compose start postgres`, puis Ctrl+C.

## Quoi regarder dans Sentry

Filtrer sur l'environnement **`verif-746`**, ouvrir l'issue (erreur Prisma / pg de connexion),
puis l'événement. Le plus fiable est le JSON brut (menu « … » → *JSON*), et y chercher `746`.

| Endroit | Attendu | Si on le voit : fuite |
|---|---|---|
| Section *Request* → *Body* / `request.data` | Absent | `MOT-DE-PASSE-FICTIF-746` ou `verif-746@exemple.invalid` |
| *Request* → *Cookies* / `request.cookies` | Absent | `REFRESH-FICTIF-746` |
| *Request* → *Headers* | `content-type`, `user-agent`, `host`… seulement | `authorization` ou `cookie` (même « [Filtered] ») |
| *Request* → *Query* / `request.query_string` | Absent | `TOKEN-FICTIF-746` |
| URL de la requête | `http://localhost:3001/api/auth/login` sans `?` | `?token=…` |
| *User* | `id` seulement si connecté ; ici aucun (route publique). Pas d'`ip_address` | Une adresse IP |
| Tags | `method: POST`, `path: /api/auth/login` | — |
| *Breadcrumbs* (type `http`) | URL nue, sans `http.query` | `apikey=` ou `?…` |
| Recherche « 746 » dans le JSON brut | Seule occurrence : l'environnement `verif-746` | Toute autre occurrence |

Une valeur « [Filtered] » à la place d'un champ signifie que le **SDK** l'a laissé passer et
que c'est le nettoyage côté serveur de Sentry qui l'a masqué : le correctif ne fonctionne pas.

## Après

- Supprimer l'issue de test dans Sentry (ou la résoudre), et l'environnement `verif-746` si
  besoin.
- Relever au passage l'hôte du DSN (`…ingest.de.sentry.io` = région UE) pour la politique de
  confidentialité.
