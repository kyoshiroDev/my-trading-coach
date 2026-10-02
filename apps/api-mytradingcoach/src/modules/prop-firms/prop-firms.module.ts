import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropFirmCatalogSyncService } from './prop-firm-catalog-sync.service';
import { PropFirmCatalogService } from './prop-firm-catalog.service';
import { PropFirmsController } from './prop-firms.controller';

/** Catalogue des règles prop firm : synchro du JSON vers la base au démarrage, lecture par l'app (PROMPT-136). */
@Module({
  imports: [PrismaModule],
  controllers: [PropFirmsController],
  providers: [PropFirmCatalogSyncService, PropFirmCatalogService],
})
export class PropFirmsModule {}
