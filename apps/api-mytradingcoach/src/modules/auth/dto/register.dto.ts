import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;

  // Consentement marketing (case non cochée par défaut côté front).
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
