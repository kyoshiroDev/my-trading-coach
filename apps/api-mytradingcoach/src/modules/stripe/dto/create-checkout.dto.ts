import { IsIn, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsIn(['premium_monthly', 'premium_yearly'], {
    message: "Plan invalide — valeurs acceptées : 'premium_monthly', 'premium_yearly'",
  })
  plan!: 'premium_monthly' | 'premium_yearly';
}
