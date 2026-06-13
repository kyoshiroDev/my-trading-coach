import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsDateString,
  ArrayMaxSize,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EmotionState,
  SetupType,
  TradeSide,
  TradingSession,
} from '@prisma/client';

export class CreateTradeDto {
  @IsString()
  @MaxLength(40)
  asset!: string;

  @IsEnum(TradeSide)
  side!: TradeSide;

  @IsNumber()
  @Min(0)
  @IsOptional()
  entry?: number;

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
  commission?: number;

  @IsNumber()
  @IsOptional()
  riskReward?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  capitalEngaged?: number;

  @IsEnum(EmotionState)
  emotion!: EmotionState;

  @IsEnum(SetupType)
  setup!: SetupType;

  @IsEnum(TradingSession)
  session!: TradingSession;

  @IsString()
  @MaxLength(20)
  timeframe!: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @IsOptional()
  tags?: string[];

  @IsDateString()
  @IsOptional()
  tradedAt?: string;

  // Compte de rattachement (multi-comptes). Absent → hérite de la session active, sinon défaut.
  @IsString()
  @IsOptional()
  accountId?: string;
}
