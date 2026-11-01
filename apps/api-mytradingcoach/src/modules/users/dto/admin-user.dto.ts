import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { normalizeUtm } from '../../auth/dto/register.dto';
import { Plan, Role } from '@prisma/client';

export class SetRoleDto {
  @IsEnum(Role)
  role!: Role;
}

export class AdminUpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(Plan) plan?: Plan;
  @IsOptional() @IsEnum(Role) role?: Role;
  /** Compte interne (#823) : exclu des statistiques admin. */
  @IsOptional() @IsBoolean() isInternal?: boolean;
}

export class AdminListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @Min(1) limit?: number;
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
