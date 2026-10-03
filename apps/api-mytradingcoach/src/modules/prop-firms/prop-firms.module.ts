import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropFirmCatalogSyncService } from './prop-firm-catalog-sync.service';
import { PropFirmCatalogService } from './prop-firm-catalog.service';
import { PropFirmPlanBackfillService } from './prop-firm-plan-backfill.service';
import { PropFirmsController } from './prop-firms.controller';

/** Catalogue des règles prop firm : synchro du JSON vers la base au démarrage, lecture par l'app (PROMPT-136). */
@Module({
  imports: [PrismaModule],
  controllers: [PropFirmsController],
  providers: [PropFirmCatalogSyncService, PropFirmCatalogService, PropFirmPlanBackfillService],
})
export class PropFirmsModule {}
