import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InfraModule } from '../modules/infra/infra.module';
import { HealthModule } from '../modules/health/health.module';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { DiscordModule } from '../modules/discord/discord.module';
import { VpsModule } from '../modules/vps/vps.module';
import { AdminModule } from '../modules/admin/admin.module';
import { SessionModule } from '../modules/session/session.module';
import { AccountsModule } from '../modules/accounts/accounts.module';
import { SetupsModule } from '../modules/setups/setups.module';
import { DailyRecapModule } from '../modules/daily-recap/daily-recap.module';
import { EcoCalendarModule } from '../modules/eco-calendar/eco-calendar.module';
import { AmbassadorModule } from '../modules/ambassador/ambassador.module';
import { ReferralModule } from '../modules/referral/referral.module';
import { PublicModule } from '../modules/public/public.module';
import { ActivityTrackingModule } from '../modules/activity-tracking/activity-tracking.module';
import { TradovateModule } from '../modules/integrations/tradovate/tradovate.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DemoReadOnlyGuard } from '../common/guards/demo-read-only.guard';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { PresenceInterceptor } from '../common/interceptors/presence.interceptor';
import { ActivityTrackingInterceptor } from '../common/interceptors/activity-tracking.interceptor';
import { AppController } from './app.controller';

import { RedisThrottlerStorage } from '../common/throttler/redis-throttler.storage';
import { bullPrefix, redisSettings } from '../modules/infra/redis-config';
import { EmailAwareThrottlerGuard } from '../common/throttler/email-aware-throttler.guard';
import { RedisService } from '../modules/infra/redis.service';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env['NODE_ENV'] === 'development'
          ? '.env.development'
          : '.env.local',
    }),
    // Limite par défaut : 60 requêtes / minute / IP (IP réelle : `trust proxy` dans main.ts).
    // Compteurs dans Redis pour être communs aux workers du cluster.
    ThrottlerModule.forRootAsync({
      imports: [InfraModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 60 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    // Même base et même préfixe que RedisService (REDIS_DB / REDIS_PREFIX, cf. redis-config.ts).
    BullModule.forRootAsync({
      useFactory: () => {
        const s = redisSettings();
        return { connection: { host: s.host, port: s.port, password: s.password, db: s.db }, prefix: bullPrefix(s) };
      },
    }),
    // Fail-safe cluster : les crons s'activent UNIQUEMENT en opt-in explicite
    // (IS_CRON_WORKER=true), à poser sur LE worker cron dédié. Par défaut (variable
    // absente) → aucun cron, donc jamais de recap 17h30 & co envoyés N fois.
    ...(process.env['IS_CRON_WORKER'] === 'true'
      ? [ScheduleModule.forRoot()]
      : []),
    InfraModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    TradesModule,
    AnalyticsModule,
    AiModule,
    DebriefModule,
    UsersModule,
    StripeModule,
    DiscordModule,
    VpsModule,
    AdminModule,
    SessionModule,
    AccountsModule,
    SetupsModule,
    DailyRecapModule,
    EcoCalendarModule,
    AmbassadorModule,
    ReferralModule,
    PublicModule,
    ActivityTrackingModule,
    TradovateModule,
  ],
  providers: [
    // Compte par IP ET par compte visé : l'IP seule bloque les voisins d'un même NAT et laisse
    // passer une attaque distribuée sur un seul compte.
    { provide: APP_GUARD, useClass: EmailAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Après JwtAuthGuard (besoin de request.user) : bloque les écritures du compte démo.
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PresenceInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ActivityTrackingInterceptor },
  ],
})
export class AppModule {}
