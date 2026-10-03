import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Plan, Role } from '@prisma/client';

export class SetRoleDto {
  @IsEnum(Role)
  role!: Role;
}

export class AdminUpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(Plan) plan?: Plan;
  @IsOptional() @IsEnum(Role) role?: Role;
}

export class AdminListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @Min(1) limit?: number;
}

/** Mois Premium offert par l'admin : durée en jours (défaut 30). */
export class OfferPremiumDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number;
}
