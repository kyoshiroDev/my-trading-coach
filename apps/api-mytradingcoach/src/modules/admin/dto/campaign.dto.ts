import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Contenu personnalisé d'une campagne email (aperçu ou envoi). Vide → contenu par défaut. */
export class CampaignContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  content?: string;
}

export class SendCampaignDto extends CampaignContentDto {
  /** Envoie même aux users encore dans la période de repos marketing. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
