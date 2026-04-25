import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../modules/auth/auth.module';
import { TradesModule } from '../modules/trades/trades.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { AiModule } from '../modules/ai/ai.module';
import { DebriefModule } from '../modules/debrief/debrief.module';
import { UsersModule } from '../modules/users/users.module';
import { StripeModule } from '../modules/stripe/stripe.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { AppController } from './app.controller';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    BullModule.forRoot({
      connection: {
        host: process.env['REDIS_HOST'] ?? 'localhost',
        port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
        password: process.env['REDIS_PASSWORD'],
      },
    }),
    // Crons uniquement sur le worker désigné (IS_CRON_WORKER=true) ou en dev
    ...(process.env['IS_CRON_WORKER'] !== 'false' ? [ScheduleModule.forRoot()] : []),
    PrismaModule,
    AuthModule,
    TradesModule,
    AnalyticsModule,
    AiModule,
    DebriefModule,
    UsersModule,
    StripeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
