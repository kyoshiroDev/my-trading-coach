import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { HELP_LIMITS as L, type HelpAskRequest, type HelpHistoryTurn, type HelpTicketRequest } from '@mtc/shared';

export class HelpHistoryTurnDto implements HelpHistoryTurn {
  @IsString()
  @MaxLength(L.historyQuestion)
  question!: string;

  @IsString()
  @MaxLength(L.historyAnswer)
  answer!: string;
}

export class HelpAskDto implements HelpAskRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(L.message)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(L.historyTurns)
  @ValidateNested({ each: true })
  @Type(() => HelpHistoryTurnDto)
  history?: HelpHistoryTurnDto[];

  @IsOptional()
  @IsString()
  @MaxLength(L.page)
  page?: string;
}

export class HelpTicketDto implements HelpTicketRequest {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(L.ticketMessage)
  message!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(L.historyTurns)
  @ValidateNested({ each: true })
  @Type(() => HelpHistoryTurnDto)
  history?: HelpHistoryTurnDto[];

  @IsOptional()
  @IsString()
  @MaxLength(L.page)
  page?: string;
}
