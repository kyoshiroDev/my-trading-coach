import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedModule } from '../shared/shared.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ logger: false }), PrismaModule, SharedModule],
  controllers: [HealthController],
})
export class HealthModule {}
