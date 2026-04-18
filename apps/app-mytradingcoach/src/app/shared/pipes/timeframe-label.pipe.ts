import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe TimeframeLabel
 *
 * Formate un identifiant de timeframe pour l'affichage dans les templates.
 *
 * On utilise un pipe plutôt qu'une méthode dans le composant car :
 * - Centralise toute évolution du formatage en un seul endroit
 * - Permet d'ajouter des abréviations ou traductions sans toucher aux composants
 * - Suit le pattern des autres pipes de présentation du projet
 *
 * @example
 * {{ '1m' | timeframeLabel }}   // "1m"
 * {{ '15m' | timeframeLabel }}  // "15m"
 * {{ '1h' | timeframeLabel }}   // "1h"
 * {{ '1D' | timeframeLabel }}   // "1D"
 * {{ '1W' | timeframeLabel }}   // "1W"
 */
@Pipe({ name: 'timeframeLabel', standalone: true })
export class TimeframeLabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ?? '—';
  }
}
