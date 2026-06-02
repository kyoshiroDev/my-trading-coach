import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content!: string;
}

class ChatDto {
  @IsString()
  @MaxLength(4000)
  message!: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Get('cooldown')
  getCooldown(@CurrentUser() user: { id: string }) {
    return this.aiService.getInsightsCooldown(user.id);
  }

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('insights')
  getInsights(@CurrentUser() user: { id: string; role: Role }) {
    return this.aiService.getInsights(user.id, user.role);
  }

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('chat')
  chat(@CurrentUser() user: { id: string; role: Role }, @Body() dto: ChatDto) {
    return this.aiService.chat(
      user.id,
      user.role,
      dto.message,
      dto.history ?? [],
    );
  }
}
