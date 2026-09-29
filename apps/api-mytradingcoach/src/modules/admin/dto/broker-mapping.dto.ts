import { IsBoolean, IsObject, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Echantillon d'un export broker : en-tete plus quelques lignes de donnees.
 *
 * Volontairement du TEXTE et non un fichier : sur un telephone, coller ce qu'on vient de
 * recevoir sur Discord est immediat, alors que telecharger la piece jointe puis la retrouver
 * dans un selecteur de fichiers ne l'est pas. 20 lignes suffisent a deduire une fiche, donc
 * la limite de taille est basse — on n'a aucune raison de faire remonter un historique entier.
 */
export class AnalyseSampleDto {
  @IsString()
  @MinLength(10)
  @MaxLength(20000)
  sample!: string;
}

/** Rejoue une fiche corrigee a la main sur le meme echantillon. Aucun appel IA. */
export class PreviewMappingDto extends AnalyseSampleDto {
  @IsObject()
  mapping!: Record<string, unknown>;
}

/** Enregistre une fiche validee. `headerHash` est derive du sample, jamais transmis. */
export class SaveMappingDto extends PreviewMappingDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  brokerName!: string;
}

export class SetMappingEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}
