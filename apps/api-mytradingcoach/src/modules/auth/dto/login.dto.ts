import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { emailTransform } from '../../../common/utils/email.util';

export class LoginDto {
  @IsEmail()
  @Transform(emailTransform)
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
