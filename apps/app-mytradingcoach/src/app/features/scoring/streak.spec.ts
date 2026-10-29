import { describe, it, expect } from 'vitest';
import { calculerStreak, decalerJour, joursOuvres, niveauActivite, JOURS_PASTILLES } from './streak';

// Repères : le 2026-10-23 est un vendredi, le 25 un dimanche, le 26 un lundi.
const jour = (date: string, tradesCount: number) => ({ date, tradesCount });
const semaine = (lundi: string, trades = 1) => [0, 1, 2, 3, 4].map((i) => jour(decalerJour(lundi, i), trades));

describe('joursOuvres', () => {
  it('35 jours du lundi au vendredi, du plus ancien au plus récent, aujourd’hui compris s’il est ouvré', () => {
    const j = joursOuvres('2026-10-26', JOURS_PASTILLES);
    expect(j).toHaveLength(35);
    expect(j.at(-1)).toBe('2026-10-26');
    expect(j[0]).toBe('2026-09-08'); // mardi : 4 jours + 6 semaines pleines + le lundi 26 = 35
    expect(j.every((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))).toBe(true);
  });

  it('un dimanche : la grille se termine au vendredi', () => {
    expect(joursOuvres('2026-10-25', 3)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
  });

  it('passage à l’heure d’hiver (25/10) sans jour sauté ni doublé', () => {
    expect(joursOuvres('2026-10-27', 3)).toEqual(['2026-10-23', '2026-10-26', '2026-10-27']);
  });
});

describe('niveauActivite : 0 · 1 · 2-3 · 4-5 · 6+', () => {
  it.each([[0, 0], [1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [6, 4], [40, 4]])('%i trade(s) → niveau %i', (n, niveau) => {
    expect(niveauActivite(n)).toBe(niveau);
  });
});

describe('calculerStreak : série actuelle', () => {
  it('aucune activité : série 0, 35 pastilles au niveau 0', () => {
    const s = calculerStreak([], '2026-10-26');
    expect(s.serie).toBe(0);
    expect(s.pastilles).toHaveLength(35);
    expect(s.pastilles.every((p) => p.niveau === 0 && p.trades === 0)).toBe(true);
  });

  it('le week-end ne casse pas la série', () => {
    const jours = [...semaine('2026-10-19'), jour('2026-10-26', 2)];
    expect(calculerStreak(jours, '2026-10-26').serie).toBe(6);
  });

  it('aujourd’hui sans trade ne casse pas la série (journée en cours)', () => {
    expect(calculerStreak(semaine('2026-10-19'), '2026-10-26').serie).toBe(5);
  });

  it('un jour ouvré passé sans trade la casse', () => {
    const jours = semaine('2026-10-19').filter((j) => j.date !== '2026-10-21'); // mercredi sans trade
    expect(calculerStreak(jours, '2026-10-23').serie).toBe(2); // jeudi + vendredi
  });

  it('un dimanche : la série court jusqu’au vendredi', () => {
    expect(calculerStreak(semaine('2026-10-19'), '2026-10-25').serie).toBe(5);
  });

  it('une activité de week-end ne compte pas et ne casse rien', () => {
    const jours = [...semaine('2026-10-19'), jour('2026-10-24', 3)];
    const s = calculerStreak(jours, '2026-10-26');
    expect(s.serie).toBe(5);
    expect(s.pastilles.some((p) => p.date === '2026-10-24')).toBe(false);
  });

  it('une série plus longue que la grille est comptée en entier', () => {
    const joursSerie = joursOuvres('2026-10-23', 60);
    const jours = joursSerie.map((d) => jour(d, 1));
    const s = calculerStreak(jours, '2026-10-23', joursSerie);
    expect(s.pastilles).toHaveLength(35);
    expect(s.serie).toBe(60);
  });
});

describe('calculerStreak : pastilles', () => {
  it('niveau et nombre de trades du jour, jour par jour', () => {
    const s = calculerStreak([jour('2026-10-22', 1), jour('2026-10-23', 7)], '2026-10-23');
    expect(s.pastilles.at(-1)).toEqual({ date: '2026-10-23', trades: 7, niveau: 4 });
    expect(s.pastilles.at(-2)).toEqual({ date: '2026-10-22', trades: 1, niveau: 1 });
    expect(s.pastilles.at(-3)).toEqual({ date: '2026-10-21', trades: 0, niveau: 0 });
  });
});
