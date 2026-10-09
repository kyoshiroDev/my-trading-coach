import { IsBoolean, IsDateString, IsOptional, ValidateIf } from 'class-validator';

/** PATCH /admin/founder-offer : interrupteur et date de fin optionnelle (null = sans fin). */
export class UpdateFounderOfferDto {
  @IsOptional()
  @IsBoolean()
  open?: boolean;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  endsAt?: string | null;
}
