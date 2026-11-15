import { IsString, MaxLength } from 'class-validator';

/**
 * Note du trader sur un objectif du débrief (C11 #1045). Bornée : elle est réinjectée dans le
 * prompt du débrief suivant (« objectifs de la semaine précédente »). Vide = note effacée.
 */
export class ObjectiveNoteDto {
  @IsString()
  @MaxLength(1000)
  note!: string;
}
