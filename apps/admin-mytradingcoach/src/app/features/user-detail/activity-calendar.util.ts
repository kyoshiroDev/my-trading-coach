/** Helpers purs du calendrier d'activité (testables sans TestBed). */

export type CalState = 'on' | 'off' | 'future' | 'pad';
export interface CalCell {
  day: number | null;
  state: CalState;
}

/** Clé jour 'YYYY-MM-DD' (mois 0-based) — même format que les activeDates backend. */
export function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Grille d'un mois, lundi en tête (offset de padding + jours numérotés). */
export function buildMonthGrid(year: number, month: number, active: Set<string>, today: Date): CalCell[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayMs = startOfDay(today).getTime();

  const cells: CalCell[] = [];
  for (let i = 0; i < offset; i++) cells.push({ day: null, state: 'pad' });
  for (let d = 1; d <= daysInMonth; d++) {
    const ms = new Date(year, month, d).getTime();
    const state: CalState = ms > todayMs ? 'future' : active.has(ymd(year, month, d)) ? 'on' : 'off';
    cells.push({ day: d, state });
  }
  return cells;
}

/** Stats sur inscription → aujourd'hui : total jours connectés, plus longue série, moyenne/sem. */
export function activityStats(
  active: Set<string>,
  signup: Date,
  today: Date,
): { total: number; best: number; avg: string } {
  const start = startOfDay(signup);
  const end = startOfDay(today);
  let total = 0;
  let streak = 0;
  let best = 0;
  for (let t = new Date(start); t <= end; t.setDate(t.getDate() + 1)) {
    if (active.has(ymd(t.getFullYear(), t.getMonth(), t.getDate()))) {
      total++;
      streak++;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  const days = Math.max(7, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  return { total, best, avg: (total / (days / 7)).toFixed(1) };
}
