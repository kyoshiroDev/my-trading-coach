import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InfraModule } from '../infra/infra.module';
import { FounderOfferModule } from '../founder-offer/founder-offer.module';
import { ResendModule } from '../resend/resend.module';
import { PropFirmCatalogService } from '../prop-firms/prop-firm-catalog.service';
import { HelpController } from './help.controller';
import { HelpService } from './help.service';

/** Chatbot de support (#493) : base locale, catalogue prop firm, Haiku sous plafond, passage à un humain. */
@Module({
  imports: [PrismaModule, InfraModule, FounderOfferModule, ResendModule],
  controllers: [HelpController],
  providers: [HelpService, PropFirmCatalogService],
})
export class HelpModule {}
