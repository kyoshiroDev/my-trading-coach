import { describe, it, expect } from 'vitest';
import { filterMorningEvents, MorningEventLike } from './session-morning.util';
import { eventKey } from '../../../../core/data/eco-event-key';

const EV = (name: string, currency: string, impact: string, time: string): MorningEventLike => ({ name, currency, impact, time });

const events: MorningEventLike[] = [
  EV('Non-Farm Payrolls (May)', 'USD', 'high', '14:30'),
  EV('CPI', 'USD', 'high', '14:30'),
  EV('Retail Sales', 'EUR', 'medium', '11:00'),
  EV('Fed Speech', 'USD', 'low', '18:00'),
];

describe('filterMorningEvents (règle pré-session)', () => {
  it('épinglé prévu aujourd’hui → affiche UNIQUEMENT les épinglés (pas les forts)', () => {
    const pins = new Set([eventKey({ name: 'Fed Speech', currency: 'USD' })]); // un pin low-impact présent
    const out = filterMorningEvents(events, pins, 'all', 'all');
    expect(out.map((e) => e.name)).toEqual(['Fed Speech']); // que l'épinglé, pas les high
  });

  it('aucun épinglé prévu → affiche les events à fort impact', () => {
    const out = filterMorningEvents(events, new Set(), 'all', 'all');
    expect(out.map((e) => e.name).sort()).toEqual(['CPI', 'Non-Farm Payrolls (May)']);
    expect(out.every((e) => e.impact === 'high')).toBe(true);
  });

  it('le pin matche par clé normalisée (suffixe de période ignoré)', () => {
    // pin sauvegardé en juin pour un type mensuel "(June)" → matche l'event "(May)"
    const pins = new Set([eventKey({ name: 'Non-Farm Payrolls (June)', currency: 'USD' })]);
    const out = filterMorningEvents(events, pins, 'all', 'all');
    expect(out.map((e) => e.name)).toEqual(['Non-Farm Payrolls (May)']);
  });

  it('filtre manuel (high) prime, indépendamment des épinglés', () => {
    const pins = new Set([eventKey({ name: 'Fed Speech', currency: 'USD' })]);
    const out = filterMorningEvents(events, pins, 'high', 'all');
    expect(out.every((e) => e.impact === 'high')).toBe(true);
    expect(out.map((e) => e.name)).not.toContain('Fed Speech');
  });

  it('respecte le filtre devise', () => {
    const out = filterMorningEvents(events, new Set(), 'all', 'EUR');
    // EUR seul → aucun high EUR → vide (pas de pin EUR non plus)
    expect(out).toEqual([]);
  });

  it('tri : épinglés d’abord puis par heure', () => {
    const pins = new Set([eventKey({ name: 'CPI', currency: 'USD' })]);
    // both high; CPI pinned → premier malgré même heure
    const out = filterMorningEvents(events, pins, 'all', 'all');
    expect(out[0].name).toBe('CPI');
  });
});
