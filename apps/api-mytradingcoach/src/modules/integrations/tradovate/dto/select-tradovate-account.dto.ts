import { IsString, Matches } from 'class-validator';

export class SelectTradovateAccountDto {
  /** Id du compte Tradovate (numérique), parmi `availableAccounts` de la connexion. */
  @IsString()
  @Matches(/^\d{1,20}$/)
  externalAccountId!: string;
}
