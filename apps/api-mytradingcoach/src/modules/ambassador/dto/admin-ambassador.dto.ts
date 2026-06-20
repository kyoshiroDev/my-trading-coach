import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class PromoteAmbassadorDto {
  @IsEmail({}, { message: 'Email invalide' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  // Optionnel : si absent, un code unique est généré côté service.
  // Normalisé en MAJUSCULES + sans espaces avant validation du format.
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{3,20}$/, {
    message: 'Le code doit faire 3 à 20 caractères, en MAJUSCULES (A-Z, 0-9), sans espace',
  })
  referralCode?: string;
}

export class RevokeAmbassadorDto {
  @IsEmail({}, { message: 'Email invalide' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;
}
