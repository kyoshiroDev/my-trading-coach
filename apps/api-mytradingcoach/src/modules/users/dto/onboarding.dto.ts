import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum Market {
  CRYPTO = 'CRYPTO',
  FOREX = 'FOREX',
  ACTIONS = 'ACTIONS',
  MULTI = 'MULTI',
}

export enum Goal {
  DISCIPLINE = 'DISCIPLINE',
  PERFORMANCE = 'PERFORMANCE',
  PSYCHOLOGIE = 'PSYCHOLOGIE',
}

export class CompleteOnboardingDto {
  @IsEnum(Market)
  @IsOptional()
  market?: Market;

  @IsEnum(Goal)
  @IsOptional()
  goal?: Goal;

  @IsNumber()
  @Min(0)
  @IsOptional()
  startingCapital?: number;

  @IsString()
  @IsOptional()
  currency?: string;
}
