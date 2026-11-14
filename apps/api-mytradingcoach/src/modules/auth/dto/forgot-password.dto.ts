import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { emailTransform } from '../../../common/utils/email.util';

export class ForgotPasswordDto {
  @IsEmail()
  @Transform(emailTransform)
  email!: string;
}
