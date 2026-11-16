/**
 * Lundi de la semaine affichée par le calendrier éco, en jour de PARIS (F11 #1047).
 *
 * Renvoyé à MIDI local du jour de Paris : `toParisDateStr` et `getDate()` donnent alors le même jour
 * pour tout navigateur entre UTC−11 et UTC+11. Avant : minuit local, qui tombait la veille à Paris à
 * l'est de Paris (La Réunion : semaine du dimanche au jeudi, vendredi perdu). Samedi et dimanche à
 * Paris : semaine suivante (comportement existant).
 */
export function parisWeekMonday(now: Date): Date {
  const [y, m, d] = now.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche, jour de Paris
  const diff = weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday;
  return new Date(y, m - 1, d + diff, 12, 0, 0, 0);
}
