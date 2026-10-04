import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PropRiskContextService } from './prop-risk-context';

@Module({
  imports: [PrismaModule],
  controllers: [AccountsController],
  // PropRiskContextService : bloc « prop firm » des prompts IA Premium (récap, débrief, #374).
  providers: [AccountsService, PropRiskContextService],
  exports: [AccountsService, PropRiskContextService],
})
export class AccountsModule {}
