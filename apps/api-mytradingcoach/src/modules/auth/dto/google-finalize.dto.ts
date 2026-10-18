import { IsBoolean } from 'class-validator';

/** Écran de finalisation d'une inscription Google : choix explicite de l'opt-in marketing. */
export class GoogleFinalizeDto {
  @IsBoolean()
  marketingConsent!: boolean;
}
