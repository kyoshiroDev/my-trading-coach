// Doit rester le premier import : Sentry s'initialise avant tout le reste.
import './instrument';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { ConsoleLogger, Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as compression from 'compression';
import { AppModule } from './app/app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PREMIUM_PRICE_MONTHLY_V2',
  'STRIPE_PREMIUM_PRICE_YEARLY_V2',
  'RESEND_API_KEY',
];
const logger = new Logger('Bootstrap');

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(
      `Variables d'environnement manquantes : ${missing.join(', ')}`,
    );
    process.exit(1);
  }
}

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger:
      process.env['NODE_ENV'] === 'production'
        ? new ConsoleLogger({ json: true })
        : new ConsoleLogger(),
  });

  // L'API est derrière UN reverse proxy (Traefik). Sans ce réglage, `req.ip` vaut l'IP du proxy
  // pour toutes les requêtes : le rate limiting mettait alors tous les utilisateurs dans le même
  // compteur. `1` = on fait confiance au dernier saut seulement (pas d'IP forgée par le client).
  app.set('trust proxy', 1);

  // API JSON pure : aucune ressource n'est servie au navigateur pour rendu.
  // CSP verrouillée + interdiction d'iframing + HSTS 1 an.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  // `robots.txt` doit répondre à la RACINE du sous-domaine (api.mytradingcoach.app/robots.txt),
  // pas sous /api → exclu du préfixe global. `health` reste sous /api/health (ne pas casser le
  // health check existant).
  // Le callback OAuth Tradovate aussi : son redirect_uri est enregistré chez Tradovate SANS
  // `/api` (`https://api.mytradingcoach.app/integrations/tradovate/callback`, PROMPT-207).
  app.setGlobalPrefix('api', {
    exclude: ['robots.txt', { path: 'integrations/tradovate/callback', method: RequestMethod.GET }],
  });

  const corsOrigins = process.env['CORS_ORIGINS']?.split(',') ?? [
    'http://localhost:4200',
  ];
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Adapter Redis pour socket.io → broadcast propagé à TOUS les workers du cluster.
  // Doit être branché avant app.listen() (init des gateways). Résilient si Redis down.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // SIGTERM (arrêt du conteneur) : Nest appelle les onModuleDestroy (Redis, Prisma, BullMQ…)
  // au lieu de couper les connexions et les jobs en plein milieu.
  app.enableShutdownHooks();

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  logger.log(`Worker ${process.pid} running on: http://localhost:${port}/api`);
}

// Clustering uniquement en production : en dev, process unique pour le debug
if (cluster.isPrimary && process.env['NODE_ENV'] === 'production') {
  const numWorkers = availableParallelism();
  logger.log(`Primary ${process.pid} starting ${numWorkers} workers...`);

  // Garde-fou contre une boucle de plantages (ex. bug au démarrage) : relance avec un délai
  // croissant, et abandon au-delà de MAX_RESTARTS en une minute. Le process principal sort
  // alors en erreur et Docker (restart: unless-stopped) redémarre le conteneur proprement.
  const MAX_RESTARTS = 5;
  const RESTART_WINDOW_MS = 60_000;
  const recentRestarts: number[] = [];
  let shuttingDown = false;

  function forkWorker(isCronWorker: boolean) {
    const worker = cluster.fork({ IS_CRON_WORKER: String(isCronWorker) });
    worker.on('exit', (code) => {
      if (shuttingDown) return;
      const now = Date.now();
      while (recentRestarts.length && now - recentRestarts[0] > RESTART_WINDOW_MS) recentRestarts.shift();
      recentRestarts.push(now);
      if (recentRestarts.length > MAX_RESTARTS) {
        logger.error(`${recentRestarts.length} workers morts en moins d'une minute : arrêt du process principal.`);
        process.exit(1);
      }
      const delayMs = Math.min(30_000, 1_000 * 2 ** (recentRestarts.length - 1));
      logger.warn(`Worker ${worker.process.pid} died (code ${code}). Restart in ${delayMs} ms...`);
      setTimeout(() => forkWorker(isCronWorker), delayMs);
    });
  }

  // Arrêt du conteneur (docker stop → SIGTERM) : on transmet aux workers, qui ferment
  // proprement leurs connexions (enableShutdownHooks), sans les relancer.
  const shutdown = (signal: NodeJS.Signals) => {
    shuttingDown = true;
    logger.log(`${signal} reçu : arrêt des workers...`);
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill(signal);
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // 1 seul worker gère les crons pour éviter les doublons
  forkWorker(true);
  for (let i = 1; i < numWorkers; i++) {
    forkWorker(false);
  }
} else {
  bootstrap();
}
