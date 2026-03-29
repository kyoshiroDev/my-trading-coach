import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app/app.module';

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL'];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Bootstrap] Variables d'environnement manquantes : ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env['NODE_ENV'] === 'production'
        ? new ConsoleLogger({ json: true })
        : new ConsoleLogger(),
  });

  app.use(helmet());
  app.setGlobalPrefix('api');

  const corsOrigins =
    process.env['CORS_ORIGINS']?.split(',') ??
    ['http://localhost:4200'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`Application running on: http://localhost:${port}/api`);
}

bootstrap();
