import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DemoAllowed } from '../../common/decorators/demo-allowed.decorator';
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

  /** Compte choisi dans le sélecteur : le coach lit ses trades, même s'il est échoué ou archivé. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountId?: string;
}

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Get('cooldown')
  getCooldown(@CurrentUser() user: { id: string; isDemo?: boolean }) {
    return this.aiService.getInsightsCooldown(user.id, user.isDemo === true);
  }

  // @DemoAllowed : la route est un POST (bloquée par défaut en démo) mais le
  // service renvoie des données figées (zéro appel modèle) pour le compte démo.
  @DemoAllowed()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('insights')
  getInsights(@CurrentUser() user: { id: string; role: Role; isDemo?: boolean }) {
    return this.aiService.getInsights(user.id, user.role, user.isDemo === true);
  }

  @DemoAllowed()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post('chat')
  chat(
    @CurrentUser() user: { id: string; role: Role; isDemo?: boolean },
    @Body() dto: ChatDto,
  ) {
    return this.aiService.chat(
      user.id,
      user.role,
      dto.message,
      dto.history ?? [],
      user.isDemo === true,
      dto.accountId && dto.accountId !== 'all' ? dto.accountId : undefined,
    );
  }
}
