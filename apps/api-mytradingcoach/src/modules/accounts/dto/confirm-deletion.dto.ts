import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Corps des suppressions définitives d'un compte de trading (DELETE /accounts/:id/archived et
 * /accounts/:id/permanent, #1069). `confirm` reste facultatif ici : le service répond
 * 400 CONFIRMATION_REQUIRED s'il n'est pas `true`.
 */
export class ConfirmDeletionDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
