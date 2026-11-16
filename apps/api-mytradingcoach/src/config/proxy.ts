import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * L'API est derrière UN reverse proxy (Traefik). Sans ce réglage, `req.ip` vaut l'IP du proxy pour
 * toutes les requêtes : le rate limiting par IP mettait alors tous les utilisateurs dans le même
 * compteur. `1` = on fait confiance au dernier saut seulement : `req.ip` est la dernière adresse de
 * `X-Forwarded-For` (celle que Traefik ajoute), une adresse forgée par le client en tête est ignorée.
 * À passer à 2 si un autre proxy est un jour placé devant l'API.
 * Utilisé par main.ts ET par les tests d'intégration (même réglage testé, #1063).
 */
export function configureProxy(app: NestExpressApplication): void {
  app.set('trust proxy', 1);
}
