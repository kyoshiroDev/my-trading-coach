import { config } from 'dotenv';
// Variables de l'API (DATABASE_URL…) : apps/api-mytradingcoach/.env, puis un éventuel .env racine
// (anciennes installations). Chemins relatifs à la racine du dépôt, d'où les scripts pnpm sont lancés.
config({ path: 'apps/api-mytradingcoach/.env', quiet: true });
config({ quiet: true });
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
    directUrl: process.env['DATABASE_DIRECT_URL'] ?? '',
  },
});
