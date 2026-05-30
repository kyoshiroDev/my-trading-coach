import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AmbassadorController } from './ambassador.controller';
import { AmbassadorService } from './ambassador.service';

@Module({
  imports: [PrismaModule],
  controllers: [AmbassadorController],
  providers: [AmbassadorService],
})
export class AmbassadorModule {}
