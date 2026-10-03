import { json } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Seule route qui a besoin du corps BRUT : la signature Stripe porte sur les octets exacts. */
export const STRIPE_WEBHOOK_PATH = '/api/billing/webhook';

/**
 * Parseurs de corps de requête (SCA-B3-06). Avant : `rawBody: true` pour TOUTES les routes, donc
 * chaque corps reçu gardé deux fois en mémoire (objet + Buffer brut), alors qu'un seul endpoint en
 * a besoin. À appeler sur une app créée avec `bodyParser: false`, AVANT `init` / `listen`.
 * Utilisé par main.ts ET par l'app des tests d'intégration (même configuration testée).
 */
export function configureBodyParsers(app: NestExpressApplication): void {
  // Webhook Stripe : JSON parsé ET corps brut conservé (req.rawBody), pour cette route seulement.
  app.use(
    STRIPE_WEBHOOK_PATH,
    json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  // Partout ailleurs : parseurs standard (ceux qu'installait Nest), sans copie brute. Un corps déjà
  // lu par le parseur du webhook n'est pas relu (body-parser ignore une requête déjà parsée).
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
}
