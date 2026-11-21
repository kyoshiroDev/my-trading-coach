import { Pipe, PipeTransform } from '@angular/core';

/**
 * Valeur d'une annonce éco avec son unité : « 4.1 % » (espace insécable avant « % », règle
 * design 5), « 250K », « 1.2M », « 3B » (suffixes collés). `null` → « - ».
 * Partagé par le calendrier éco, la séance du matin et la prochaine annonce de la séance live (#1179).
 */
export function formatEcoValue(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return '-';
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(',', '.')}${unit === '%' ? '\u00a0%' : (unit ?? '')}`;
}

@Pipe({ name: 'ecoValue' })
export class EcoValuePipe implements PipeTransform {
  transform(value: number | null | undefined, unit?: string | null): string {
    return formatEcoValue(value, unit);
  }
}
