import { describe, expect, it } from 'vitest';
import { addDays, lastActivity, nextInactivityAction, parisDay, selectionCutoff } from './inactivity-purge.util';

// Dates fixes (règle du dépôt). Dernière connexion le 10/01/2024 à 15 h Paris → J = 09/01/2026 (730 jours).
const ACTIVITY = new Date('2024-01-10T14:00:00Z');
const at = (day: string) => new Date(`${day}T09:00:00Z`); // 10 h Paris (hiver)

describe('dates en jours de Paris', () => {
  it('jour de Paris, y compris juste après minuit Paris (encore la veille en UTC)', () => {
    expect(parisDay(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-02');
    expect(parisDay(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
  });
  it('décalage de jours, passage de mois et d’année compris', () => {
    expect(addDays('2026-01-09', -28)).toBe('2025-12-12');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('dernière connexion', () => {
  const created = new Date('2023-01-01T00:00:00Z');
  it('la plus récente de lastSeenAt et lastLoginAt', () => {
    expect(lastActivity({ lastSeenAt: new Date('2024-01-05'), lastLoginAt: new Date('2024-01-10'), createdAt: created })).toEqual(new Date('2024-01-10'));
    expect(lastActivity({ lastSeenAt: new Date('2024-02-01'), lastLoginAt: null, createdAt: created })).toEqual(new Date('2024-02-01'));
  });
  it('aucune des deux : date d’inscription', () => {
    expect(lastActivity({ lastSeenAt: null, lastLoginAt: null, createdAt: created })).toEqual(created);
  });
});

describe('cycle de préavis (J-28, J-21, J-14, J-7, suppression à J)', () => {
  it('avant J-28 : rien', () => {
    expect(nextInactivityAction('2025-12-11', ACTIVITY, [])).toEqual({ kind: 'none' });
  });

  it('calendrier nominal : 4 préavis annonçant J, puis suppression à J', () => {
    expect(nextInactivityAction('2025-12-12', ACTIVITY, [])).toEqual({ kind: 'notice', rank: 1, deletionDay: '2026-01-09' });
    const n1 = at('2025-12-12');
    expect(nextInactivityAction('2025-12-18', ACTIVITY, [n1])).toEqual({ kind: 'none' });
    expect(nextInactivityAction('2025-12-19', ACTIVITY, [n1])).toEqual({ kind: 'notice', rank: 2, deletionDay: '2026-01-09' });
    const n2 = at('2025-12-19');
    expect(nextInactivityAction('2025-12-26', ACTIVITY, [n1, n2])).toEqual({ kind: 'notice', rank: 3, deletionDay: '2026-01-09' });
    const n3 = at('2025-12-26');
    expect(nextInactivityAction('2026-01-02', ACTIVITY, [n1, n2, n3])).toEqual({ kind: 'notice', rank: 4, deletionDay: '2026-01-09' });
    const n4 = at('2026-01-02');
    expect(nextInactivityAction('2026-01-08', ACTIVITY, [n1, n2, n3, n4])).toEqual({ kind: 'none' });
    expect(nextInactivityAction('2026-01-09', ACTIVITY, [n1, n2, n3, n4])).toEqual({ kind: 'delete', deletionDay: '2026-01-09' });
  });

  it('compte déjà inactif depuis plus de 2 ans au lancement : tout le mois de préavis d’abord', () => {
    const old = new Date('2021-05-01T10:00:00Z');
    expect(nextInactivityAction('2026-03-02', old, [])).toEqual({ kind: 'notice', rank: 1, deletionDay: '2026-03-30' });
    const sent = [at('2026-03-02'), at('2026-03-09'), at('2026-03-16')];
    expect(nextInactivityAction('2026-03-20', old, sent)).toEqual({ kind: 'none' }); // jamais moins de 7 jours d'écart
    expect(nextInactivityAction('2026-03-23', old, sent)).toEqual({ kind: 'notice', rank: 4, deletionDay: '2026-03-30' });
    expect(nextInactivityAction('2026-03-29', old, [...sent, at('2026-03-23')])).toEqual({ kind: 'none' });
    expect(nextInactivityAction('2026-03-30', old, [...sent, at('2026-03-23')])).toEqual({ kind: 'delete', deletionDay: '2026-03-30' });
  });

  it('préavis en retard (panne, plafond) : la date annoncée recule, jamais avant la date écrite', () => {
    const n1 = at('2025-12-12');
    // Préavis 2 parti avec 10 jours de retard : il annonce 19 jours plus tard, pas J.
    expect(nextInactivityAction('2025-12-29', ACTIVITY, [n1])).toEqual({ kind: 'notice', rank: 2, deletionDay: '2026-01-19' });
    const late = [n1, at('2025-12-29'), at('2026-01-05'), at('2026-01-12')];
    expect(nextInactivityAction('2026-01-18', ACTIVITY, late)).toEqual({ kind: 'none' });
    expect(nextInactivityAction('2026-01-19', ACTIVITY, late)).toEqual({ kind: 'delete', deletionDay: '2026-01-19' });
  });

  it('écart de 7 jours en jours de Paris : un passage quelques minutes plus tôt ne rate pas son tour', () => {
    const n1 = new Date('2025-12-12T09:05:00Z');
    expect(nextInactivityAction(parisDay(new Date('2025-12-19T08:58:00Z')), ACTIVITY, [n1])).toMatchObject({ kind: 'notice', rank: 2 });
  });
});

describe('seuil de sélection', () => {
  it('dernière activité avant le 1er préavis, avec un jour de marge', () => {
    expect(selectionCutoff(new Date('2026-01-09T09:00:00Z')).toISOString()).toBe('2024-02-08T09:00:00.000Z') // 701 jours (2024 bissextile);
  });
});
