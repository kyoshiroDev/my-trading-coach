import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizeUtm } from '../../auth/dto/register.dto';
import { Role } from '@prisma/client';

export class SetRoleDto {
  @IsEnum(Role)
  role!: Role;
}

/**
 * Modale « Modifier » de l'admin (A1/B2 #1064, décision du 16/11) : le nom et « compte interne »
 * seulement. Le rôle passe par `PATCH :id/role` et les routes bêta (setRole garde l'invariant
 * ambassadeur = code), le plan par « Offrir Premium » ou le rôle bêta ; un abonné Stripe n'est
 * jamais modifié à la main. `role` ou `plan` envoyés → 400 (forbidNonWhitelisted).
 */
export class AdminUpdateUserDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  /** Compte interne (#823) : exclu des statistiques admin. */
  @IsOptional() @IsBoolean() isInternal?: boolean;
}

export class AdminListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) limit?: number; // #1063 : plus de table entière
  /**
   * Inscrits d'une campagne (#625) : égalité exacte, normalisée comme à l'inscription.
   * `-` (`UTM_NONE`) = non renseigné. Cf. `@mtc/shared` acquisition-filter.
   */
  @IsOptional() @Transform(normalizeUtm) @IsString() @MaxLength(100) source?: string;
  @IsOptional() @Transform(normalizeUtm) @IsString() @MaxLength(100) medium?: string;
  @IsOptional() @Transform(normalizeUtm) @IsString() @MaxLength(100) campaign?: string;
}

/** Mois Premium offert par l'admin : durée en jours (défaut 30). */
export class OfferPremiumDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}
