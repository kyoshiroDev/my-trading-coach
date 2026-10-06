import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DemoSeedService } from './demo-seed.service';

/** Seed du compte démo, partagé par l'admin (bouton, cron) et l'auth (connexion démo). */
@Module({
  imports: [PrismaModule],
  providers: [DemoSeedService],
  exports: [DemoSeedService],
})
export class DemoSeedModule {}
