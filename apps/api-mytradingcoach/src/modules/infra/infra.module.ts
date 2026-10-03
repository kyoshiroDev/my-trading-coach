import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { AiLoggerService } from './ai-logger.service';
import { AnthropicClientService } from './anthropic-client.service';
import { AuthUserCacheService } from './auth-user-cache.service';

/**
 * Infrastructure technique commune à tous les modules (global) : Redis, client Anthropic,
 * journal des appels IA. Rien de métier ici. À ne pas confondre avec `@mtc/shared`
 * (libs/shared : code pur partagé avec le front).
 */
@Global()
@Module({
  providers: [RedisService, AiLoggerService, AnthropicClientService, AuthUserCacheService],
  exports:   [RedisService, AiLoggerService, AnthropicClientService, AuthUserCacheService],
})
export class InfraModule {}
