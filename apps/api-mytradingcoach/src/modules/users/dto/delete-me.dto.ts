import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Corps de DELETE /users/me (#1069) : raison facultative, choisie dans la liste du profil. */
export class DeleteMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(280) // longueur enregistrée dans DeletedAccount.reason
  reason?: string;
}
