import { IsIn, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsIn(['monthly', 'yearly'], { message: "Plan invalide — valeurs acceptées : 'monthly', 'yearly'" })
  plan!: 'monthly' | 'yearly';
}
