import { IsEnum, IsOptional, IsString, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { EmotionState, SetupType, TradeSide } from '@prisma/client';

export class TradeFiltersDto {
  @IsString()
  @IsOptional()
  cursor?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  @IsOptional()
  limit?: number = 20;

  @IsEnum(TradeSide)
  @IsOptional()
  side?: TradeSide;

  @IsEnum(SetupType)
  @IsOptional()
  setup?: SetupType;

  @IsEnum(EmotionState)
  @IsOptional()
  emotion?: EmotionState;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
