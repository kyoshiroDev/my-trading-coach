import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AmbassadorModule } from '../ambassador/ambassador.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule, AmbassadorModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
