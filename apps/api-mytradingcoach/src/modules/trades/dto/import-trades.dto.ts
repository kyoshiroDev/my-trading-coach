import { IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Champs texte du multipart d'import CSV (les fichiers arrivent via @UploadedFiles).
 * En multipart tout est une chaîne : `totalFees` est donc un nombre sous forme de texte.
 */
export class ImportTradesBodyDto {
  @IsOptional()
  @IsNumberString()
  totalFees?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountId?: string;

  /** Émotion appliquée au lot. Chaîne libre : normalisée (ou ignorée) par CsvImportService. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  emotion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  setupId?: string;
}
