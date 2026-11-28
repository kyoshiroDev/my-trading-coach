import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { SessionContractDto } from './session-contract.dto';
import { MoodState } from '@prisma/client';

export class CreateSessionDto {
  @IsEnum(MoodState)
  mood!: MoodState;

  // Compte auquel rattacher la session (multi-comptes). Absent → compte par défaut.
  @IsString()
  @IsOptional()
  accountId?: string;

  // Contrat de session (#667), ignoré tant que SESSION_CONTRACT_ENABLED est éteint.
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionContractDto)
  contract?: SessionContractDto;
}
