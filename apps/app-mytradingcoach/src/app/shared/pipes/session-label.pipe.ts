import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe SessionLabel
 *
 * Transforme une clé de session de trading en label lisible pour l'affichage.
 *
 * On utilise un pipe plutôt qu'une méthode dans le composant car :
 * - La même table de correspondance serait dupliquée dans chaque composant
 *   qui affiche des sessions (analytics, journal, debrief...)
 * - La logique de formatage n'appartient pas au composant — c'est une règle de présentation
 * - Le template reste déclaratif : {{ trade.session | sessionLabel }}
 *
 * @example
 * {{ 'LONDON' | sessionLabel }}     // "London"
 * {{ 'NEW_YORK' | sessionLabel }}   // "New York"
 * {{ 'ASIAN' | sessionLabel }}      // "Asian"
 * {{ 'PRE_MARKET' | sessionLabel }} // "Pre-Market"
 * {{ 'OVERLAP' | sessionLabel }}    // "Overlap"
 */
@Pipe({ name: 'sessionLabel', standalone: true })
export class SessionLabelPipe implements PipeTransform {
  private static readonly LABELS: Record<string, string> = {
    LONDON: 'London',
    NEW_YORK: 'New York',
    ASIAN: 'Asian',
    PRE_MARKET: 'Pre-Market',
    OVERLAP: 'Overlap',
  };

  transform(value: string | null | undefined): string {
    if (!value) return '—';
    return SessionLabelPipe.LABELS[value] ?? value;
  }
}
