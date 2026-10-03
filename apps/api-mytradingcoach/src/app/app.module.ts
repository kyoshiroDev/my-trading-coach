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
import { PropFirmsModule } from '../modules/prop-firms/prop-firms.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DemoReadOnlyGuard } from '../common/guards/demo-read-only.guard';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { PresenceInterceptor } from '../common/interceptors/presence.interceptor';
import { ActivityTrackingInterceptor } from '../common/interceptors/activity-tracking.interceptor';
import { AppController } from './app.controller';

import { RedisThrottlerStorage } from '../common/throttler/redis-throttler.storage';
import { bullPrefix, redisSettings } from '../modules/infra/redis-config';
import { EmailAwareThrottlerGuard, IP_THROTTLER, IP_THROTTLER_OFF, defaultThrottleLimit } from '../common/throttler/email-aware-throttler.guard';
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
    // Limite par défaut : 300 requêtes / minute par UTILISATEUR connecté, 60 / minute / IP sinon
    // (SCA-B3-03 ; IP réelle : `trust proxy` dans main.ts). Compteurs Redis communs aux workers.
    ThrottlerModule.forRootAsync({
      imports: [InfraModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          { ttl: 60_000, limit: defaultThrottleLimit },
          // Par IP seule, neutre sauf sur les routes qui le resserrent (inscription, connexion…).
          { name: IP_THROTTLER, ttl: 60_000, limit: IP_THROTTLER_OFF },
        ],
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
    PropFirmsModule,
  ],
  providers: [
    // JwtAuthGuard AVANT le throttler (SCA-B3-03) : un utilisateur connecté est compté par son
    // identifiant vérifié (300/min), un anonyme par IP + compte visé (60/min ; l'IP seule
    // bloquerait les voisins d'un même NAT). Les routes @Public passent sans identifier personne.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: EmailAwareThrottlerGuard },
    // Après JwtAuthGuard (besoin de request.user) : bloque les écritures du compte démo.
    { provide: APP_GUARD, useClass: DemoReadOnlyGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PresenceInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ActivityTrackingInterceptor },
  ],
})
export class AppModule {}
