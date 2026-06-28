import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SetupsController } from './setups.controller';
import { SetupsService } from './setups.service';

@Module({
  imports: [PrismaModule],
  controllers: [SetupsController],
  providers: [SetupsService],
  exports: [SetupsService],
})
export class SetupsModule {}
