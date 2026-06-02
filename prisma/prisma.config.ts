import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
    directUrl: process.env['DATABASE_DIRECT_URL'] ?? '',
  },
});
