import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const pool = new Pool({
      connectionString:
        process.env['DATABASE_URL'] ??
        'postgresql://mtc_user:devpassword@localhost:5432/mytradingcoach_dev',
      keepAlive: true,
      idleTimeoutMillis: 20000,
      max: 10,
    });
    pool.on('error', (err) => {
      console.error('[PrismaService] idle client error:', err.message);
    });
    const adapter = new PrismaPg(pool);
    super({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
