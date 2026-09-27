/** Dates du calendrier éco, évaluées en heure de Paris (fonctions pures). */

export function toParisDateTime(utcDateStr: string): { date: string; time: string } {
  try {
    const d = new Date(utcDateStr.replace(' ', 'T') + 'Z');
    const date = d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    const time = d.toLocaleTimeString('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return { date, time };
  } catch {
    return { date: utcDateStr.slice(0, 10), time: utcDateStr.slice(11, 16) };
  }
}

export function nextTradingDay(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  // Saut des week-ends en jour de PARIS (cohérent avec toParisDateStr en aval) :
  // près de minuit UTC, le getDay() local pouvait renvoyer un jour ≠ de la date Paris
  // formatée → on pouvait produire une date Paris tombant un samedi/dimanche.
  while (parisWeekday(d) === 0 || parisWeekday(d) === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** Jour de la semaine (0=dim … 6=sam) d'une Date, évalué en heure de Paris. */
export function parisWeekday(d: Date): number {
  const short = d.toLocaleDateString('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? d.getDay();
}

export function isAfterSessionClose(date: Date = new Date()): boolean {
  const parisHour = parseInt(
    date.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      hour12: false,
    }),
    10,
  );
  return parisHour >= 18;
}

export function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
