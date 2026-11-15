/**
 * F11 (#1047) : le lundi de la semaine était un minuit LOCAL. À l'est de Paris (La Réunion, UTC+4),
 * ce minuit tombe le dimanche à 21 h à Paris : la semaine affichée allait du dimanche au jeudi et
 * le vendredi (NFP…) disparaissait.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { toParisDateStr } from '@mtc/shared';
import { parisWeekMonday } from './eco-week';

const savedTz = process.env['TZ'];
afterEach(() => { process.env['TZ'] = savedTz; });

/** Les 5 jours de Paris affichés à partir du lundi renvoyé (même calcul que la vue semaine). */
function weekOf(monday: Date): string[] {
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toParisDateStr(d);
  });
}

const SEMAINE = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];

describe('parisWeekMonday', () => {
  it.each(['Europe/Paris', 'Indian/Reunion', 'Asia/Tokyo', 'America/New_York', 'Pacific/Honolulu'])(
    'navigateur en %s, mercredi midi à Paris : du lundi au vendredi de Paris',
    (tz) => {
      process.env['TZ'] = tz;
      expect(weekOf(parisWeekMonday(new Date('2026-11-18T11:00:00Z')))).toEqual(SEMAINE);
    },
  );

  it('La Réunion, mardi 1 h 30 locale (lundi 22 h 30 à Paris) : semaine du lundi 16', () => {
    process.env['TZ'] = 'Indian/Reunion';
    expect(weekOf(parisWeekMonday(new Date('2026-11-16T21:30:00Z')))).toEqual(SEMAINE);
  });

  it('samedi ou dimanche à Paris : semaine suivante (comportement existant)', () => {
    process.env['TZ'] = 'Indian/Reunion';
    expect(weekOf(parisWeekMonday(new Date('2026-11-14T12:00:00Z')))).toEqual(SEMAINE);
    expect(weekOf(parisWeekMonday(new Date('2026-11-15T12:00:00Z')))).toEqual(SEMAINE);
  });
});
