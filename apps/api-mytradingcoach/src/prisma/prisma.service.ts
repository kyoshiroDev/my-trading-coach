import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { dbPoolConfig } from './pool-config';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Taille et délais : pool-config.ts (DB_POOL_MAX, défaut 5 par process ; Postgres limité à 50).
    const pool = new Pool(dbPoolConfig());
    pool.on('error', (err) => {
      this.logger.error(`idle client error: ${err.message}`);
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
