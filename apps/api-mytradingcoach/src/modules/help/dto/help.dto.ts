import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { HelpAskRequest, HelpHistoryTurn, HelpTicketRequest } from '@mtc/shared';

export class HelpHistoryTurnDto implements HelpHistoryTurn {
  @IsString()
  @MaxLength(500)
  question!: string;

  @IsString()
  @MaxLength(500)
  answer!: string;
}

export class HelpAskDto implements HelpAskRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => HelpHistoryTurnDto)
  history?: HelpHistoryTurnDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  page?: string;
}

export class HelpTicketDto implements HelpTicketRequest {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => HelpHistoryTurnDto)
  history?: HelpHistoryTurnDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  page?: string;
}
