import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { SessionCloseCron } from './session-close.cron';
import { AdminSessionsController } from './admin-sessions.controller';
import { SessionDaysRepairService } from './session-days-repair.service';
import { AccountsModule } from '../accounts/accounts.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [PrismaModule, AccountsModule, AnalyticsModule],
  controllers: [SessionController, AdminSessionsController],
  providers: [SessionService, SessionCloseCron, SessionDaysRepairService],
  exports: [SessionService],
})
export class SessionModule {}
