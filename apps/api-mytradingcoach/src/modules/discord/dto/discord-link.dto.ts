import { IsString, Matches, MaxLength } from 'class-validator';

/** Envoyé par le bot quand un membre tape `/verify code:` (#741). */
export class RedeemDiscordCodeDto {
  /** Tel que tapé : la forme est normalisée par le service (tirets, espaces, casse). */
  @IsString() @MaxLength(32)
  code!: string;

  /** Identifiant Discord (snowflake) de la personne qui a tapé la commande. */
  @IsString() @Matches(/^\d{15,25}$/)
  discordId!: string;
}
