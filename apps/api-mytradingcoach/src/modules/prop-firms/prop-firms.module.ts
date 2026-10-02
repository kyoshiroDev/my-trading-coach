import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropFirmCatalogSyncService } from './prop-firm-catalog-sync.service';

/** Catalogue des règles prop firm : synchro du JSON vers la base au démarrage (PROMPT-136). */
@Module({
  imports: [PrismaModule],
  providers: [PropFirmCatalogSyncService],
})
export class PropFirmsModule {}
