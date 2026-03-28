import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { IsArray, IsOptional, IsString } from 'class-validator';

class ChatDto {
  @IsString()
  message!: string;

  @IsArray()
  @IsOptional()
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('insights')
  getInsights(@CurrentUser() user: { id: string }) {
    return this.aiService.getInsights(user.id);
  }

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('chat')
  chat(
    @CurrentUser() user: { id: string },
    @Body() dto: ChatDto,
  ) {
    return this.aiService.chat(user.id, dto.message, dto.history ?? []);
  }
}