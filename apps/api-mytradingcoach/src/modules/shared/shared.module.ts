import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { AiLoggerService } from './ai-logger.service';
import { AnthropicClientService } from './anthropic-client.service';

@Global()
@Module({
  providers: [RedisService, AiLoggerService, AnthropicClientService],
  exports:   [RedisService, AiLoggerService, AnthropicClientService],
})
export class SharedModule {}
