import { IsIn, IsOptional } from 'class-validator';
import type { OAuthOrigin } from '../oauth-state.util';

export class AuthorizeTradovateDto {
  /** Écran de départ : le retour OAuth y ramène l'utilisateur. Défaut : réglages. */
  @IsOptional()
  @IsIn(['wizard', 'settings'])
  origin?: OAuthOrigin;
}
