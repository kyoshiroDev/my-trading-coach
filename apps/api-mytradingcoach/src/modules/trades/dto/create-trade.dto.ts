import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsDateString,
  Min,
} from 'class-validator';
import { EmotionState, SetupType, TradeSide, TradingSession } from '@prisma/client';

export class CreateTradeDto {
  @IsString()
  asset!: string;

  @IsEnum(TradeSide)
  side!: TradeSide;

  @IsNumber()
  @Min(0)
  entry!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  exit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  stopLoss?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  takeProfit?: number;

  @IsNumber()
  @IsOptional()
  pnl?: number;

  @IsNumber()
  @IsOptional()
  riskReward?: number;

  @IsEnum(EmotionState)
  emotion!: EmotionState;

  @IsEnum(SetupType)
  setup!: SetupType;

  @IsEnum(TradingSession)
  session!: TradingSession;

  @IsString()
  timeframe!: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsDateString()
  @IsOptional()
  tradedAt?: string;
}
