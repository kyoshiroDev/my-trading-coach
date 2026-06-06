import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
  'STRIPE_STARTER_PRICE_MONTHLY',
  'STRIPE_STARTER_PRICE_YEARLY',
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
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger:
      process.env['NODE_ENV'] === 'production'
        ? new ConsoleLogger({ json: true })
        : new ConsoleLogger(),
  });

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
  app.setGlobalPrefix('api');

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

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  logger.log(`Worker ${process.pid} running on: http://localhost:${port}/api`);
}

// Clustering uniquement en production — en dev, process unique pour le debug
if (cluster.isPrimary && process.env['NODE_ENV'] === 'production') {
  const numWorkers = availableParallelism();
  logger.log(`Primary ${process.pid} starting ${numWorkers} workers...`);

  function forkWorker(isCronWorker: boolean) {
    const worker = cluster.fork({ IS_CRON_WORKER: String(isCronWorker) });
    worker.on('exit', (code) => {
      logger.warn(
        `Worker ${worker.process.pid} died (code ${code}). Restarting...`,
      );
      forkWorker(isCronWorker);
    });
  }

  // 1 seul worker gère les crons pour éviter les doublons
  forkWorker(true);
  for (let i = 1; i < numWorkers; i++) {
    forkWorker(false);
  }
} else {
  bootstrap();
}
