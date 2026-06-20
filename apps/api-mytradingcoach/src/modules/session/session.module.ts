import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
