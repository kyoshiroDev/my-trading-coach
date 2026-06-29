import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SETUP_PALETTE } from '../setups.defaults';

export class UpdateSetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @IsOptional()
  title?: string;

  @IsIn(SETUP_PALETTE)
  @IsOptional()
  color?: string;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  description?: string;
}
