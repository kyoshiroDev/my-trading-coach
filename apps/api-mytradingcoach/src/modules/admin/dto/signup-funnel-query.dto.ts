import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/** GET /admin/signup-funnel?days=7|30 (30 par défaut). */
export class SignupFunnelQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30])
  days?: 7 | 30;
}
