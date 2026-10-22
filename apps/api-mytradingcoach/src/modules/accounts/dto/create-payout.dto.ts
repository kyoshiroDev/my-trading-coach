import { IsNumber, Matches, Max, Min } from 'class-validator';

/** Payout saisi à la main (compte funded sans connexion broker). */
export class CreatePayoutDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La date du payout doit être au format AAAA-MM-JJ.' })
  tradeDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Le montant du payout doit être un nombre (2 décimales max).' })
  @Min(0.01, { message: 'Le montant du payout doit être supérieur à 0.' })
  @Max(10_000_000, { message: 'Le montant du payout est trop élevé.' })
  amount!: number;
}
