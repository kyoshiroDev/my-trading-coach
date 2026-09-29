import { IsEnum, IsOptional, IsString, Min } from 'class-validator';
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
