import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SETUP_PALETTE } from '../setups.defaults';

export class CreateSetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  title!: string;

  @IsIn(SETUP_PALETTE)
  color!: string;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  description?: string;
}
