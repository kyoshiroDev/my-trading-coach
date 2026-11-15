import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Sélection du jour : clés « nom:devise » (C11 #1045). Absente = sélection vidée. */
export class SavePinsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  pins?: string[];
}

/** Annonce publiée à analyser (C11 #1045) : sans nom, `stripPeriod` levait une erreur 500. */
export class AnalyzeResultDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  eventName!: string;
}
