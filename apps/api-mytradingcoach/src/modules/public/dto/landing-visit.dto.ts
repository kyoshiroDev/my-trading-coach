import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Page vue sur la landing (mesure d'audience sans cookie). Aucune donnée personnelle :
 * page, source agrégée (utm_source ou hôte d'origine) et « 1re page de la session ».
 */
export class LandingVisitDto {
  // Chemin seul (query et fragment retirés), slash final retiré sauf pour la racine.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(/[?#]/)[0].replace(/(.)\/+$/, '$1') : value,
  )
  @IsString()
  @Matches(/^\//)
  @MaxLength(200)
  path!: string;

  // Même normalisation que les UTM d'inscription : regroupement fiable à l'agrégation.
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsBoolean()
  entry!: boolean;
}
