import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Candidature ambassadeur depuis la landing (publique, sans compte).
 * L'audience est en multi-sélection (chips) + des liens de profils.
 */
export class PublicAmbassadorApplyDto {
  @IsString()
  @MinLength(2, { message: 'Indique ton nom ou pseudo.' })
  @MaxLength(80)
  name!: string;

  @IsEmail({}, { message: 'Email invalide.' })
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  communities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  links?: string;

  @IsOptional()
  @IsBoolean()
  hasCompany?: boolean;
}
