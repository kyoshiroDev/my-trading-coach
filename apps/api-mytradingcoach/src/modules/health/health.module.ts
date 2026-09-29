import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '../../prisma/prisma.module';
import { InfraModule } from '../infra/infra.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ logger: false }), PrismaModule, InfraModule],
  controllers: [HealthController],
})
export class HealthModule {}
