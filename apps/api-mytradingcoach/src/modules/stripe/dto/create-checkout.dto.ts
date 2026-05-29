import { IsIn, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsIn(['starter_monthly', 'starter_yearly', 'premium_monthly', 'premium_yearly'], {
    message: "Plan invalide — valeurs acceptées : 'starter_monthly', 'starter_yearly', 'premium_monthly', 'premium_yearly'",
  })
  plan!: 'starter_monthly' | 'starter_yearly' | 'premium_monthly' | 'premium_yearly';
}
