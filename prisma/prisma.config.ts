import { defineConfig } from 'prisma/config';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://mtc_user:devpassword@localhost:5432/mytradingcoach_dev';

export default defineConfig({
  schema: 'schema.prisma',
  datasource: {
    url: connectionString,
  },
});
