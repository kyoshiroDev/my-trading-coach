import { AdminPushModule } from '../admin-push/admin-push.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [PrismaModule, ResendModule, AdminPushModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
