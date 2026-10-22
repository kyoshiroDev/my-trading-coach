import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PropRiskContextService } from './prop-risk-context';
import { AccountIncidentsService } from './incidents/account-incidents.service';

@Module({
  imports: [PrismaModule],
  controllers: [AccountsController],
  // PropRiskContextService : bloc « prop firm » des prompts IA Premium (récap, débrief, #374).
  // AccountIncidentsService : autopsie d'un compte grillé (#669), déclenchée aussi par la synchro et les alertes.
  providers: [AccountsService, PropRiskContextService, AccountIncidentsService],
  exports: [AccountsService, PropRiskContextService, AccountIncidentsService],
})
export class AccountsModule {}
