import { IsIn, IsOptional, IsString } from 'class-validator';
import { OFFER_CTAS, type OfferCta } from '@mtc/shared';

export const CHECKOUT_PLANS = ['premium_monthly', 'premium_yearly', 'founder_monthly', 'founder_yearly'] as const;
export type CheckoutPlan = (typeof CHECKOUT_PLANS)[number];

export class CreateCheckoutDto {
  @IsString()
  @IsIn(CHECKOUT_PLANS, {
    message: "Plan invalide. Valeurs acceptées : 'premium_monthly', 'premium_yearly', 'founder_monthly', 'founder_yearly'",
  })
  plan!: CheckoutPlan;

  /** Point de clic d'origine (#525), conservé jusqu'au checkout et en base. */
  @IsOptional()
  @IsIn(OFFER_CTAS)
  cta?: OfferCta;
}
