import { describe, expect, it } from 'vitest';
import { averageKnownRiskReward, plannedRiskReward, stopPlacementError, stopRiskAmount } from './trade-risk';

describe('plannedRiskReward', () => {
  it('LONG : (objectif − entrée) / (entrée − stop), au centième', () => {
    // MGC du 9/11 (rapport Orders) : entrée 4134.6, stop 4109.4, objectif 4212.8.
    expect(plannedRiskReward('LONG', 4134.6, 4109.4, 4212.8)).toBe(3.1);
    expect(plannedRiskReward('LONG', 100, 90, 125)).toBe(2.5);
  });

  it('SHORT : sens inversé', () => {
    expect(plannedRiskReward('SHORT', 100, 110, 80)).toBe(2);
  });

  it('sans objectif (ou sans stop) : inconnu, jamais 0', () => {
    expect(plannedRiskReward('LONG', 100, 90, null)).toBeUndefined();
    expect(plannedRiskReward('LONG', 100, null, 120)).toBeUndefined();
    expect(plannedRiskReward('LONG', 100, 90, undefined)).toBeUndefined();
  });

  it('risque nul ou gain prévu négatif : inconnu', () => {
    expect(plannedRiskReward('LONG', 100, 100, 120)).toBeUndefined();
    expect(plannedRiskReward('LONG', 100, 90, 95 - 10)).toBeUndefined();
  });
});

describe('stopPlacementError', () => {
  it('stop et objectif du bon côté : aucune erreur', () => {
    expect(stopPlacementError('LONG', 100, 90, 120)).toBeNull();
    expect(stopPlacementError('SHORT', 100, 110, 80)).toBeNull();
    expect(stopPlacementError('LONG', 100, 90)).toBeNull();
    expect(stopPlacementError('LONG', 100, 90, null)).toBeNull();
  });

  it('LONG avec un stop au-dessus (ou au niveau) de l’entrée : refusé, message clair', () => {
    expect(stopPlacementError('LONG', 100, 105)).toBe("Sur un achat (LONG), le stop doit être sous le prix d'entrée (100).");
    expect(stopPlacementError('LONG', 100, 100)).toMatch(/sous le prix d'entrée/);
  });

  it('SHORT avec un stop sous l’entrée : refusé', () => {
    expect(stopPlacementError('SHORT', 100, 95)).toBe("Sur une vente (SHORT), le stop doit être au-dessus du prix d'entrée (100).");
  });

  it('objectif du mauvais côté : refusé', () => {
    expect(stopPlacementError('LONG', 100, 90, 95)).toMatch(/l'objectif doit être au-dessus/);
    expect(stopPlacementError('SHORT', 100, 110, 105)).toMatch(/l'objectif doit être sous/);
  });

  it('prix négatif, nul ou illisible : refusé', () => {
    expect(stopPlacementError('LONG', 100, 0)).toBe('Le stop doit être un prix positif.');
    expect(stopPlacementError('LONG', 100, Number.NaN)).toBe('Le stop doit être un prix positif.');
    expect(stopPlacementError('LONG', 100, 90, -1)).toBe("L'objectif doit être un prix positif.");
  });
});

describe('stopRiskAmount', () => {
  it('ticks × valeur du tick × quantité (table des instruments)', () => {
    // MNQ : tick 0.25 = 0.50 $ (2 $ le point). MNQ du 9/11 : 229.75 pts → 459.50 $.
    expect(stopRiskAmount(27092.25, 26862.5, 1, 0.25, 0.5)).toBe(459.5);
    // MGC : tick 0.1 = 1 $ (10 $ le point). 25.2 pts → 252 $.
    expect(stopRiskAmount(4134.6, 4109.4, 1, 0.1, 1)).toBe(252);
    // Quantité 3 sur ES (12.50 $ le tick, 50 $ le point) : 4 pts → 600 $.
    expect(stopRiskAmount(5000, 4996, 3, 0.25, 12.5)).toBe(600);
  });

  it('SHORT : même risque (distance absolue)', () => {
    expect(stopRiskAmount(100, 102, 1, 0.25, 1.25)).toBe(10);
  });

  it('quantité absente = 1', () => {
    expect(stopRiskAmount(100, 99, null, 0.25, 0.5)).toBe(2);
  });

  it('valeur du tick inconnue : null, jamais un montant deviné', () => {
    expect(stopRiskAmount(100, 99, 1, undefined, null)).toBeNull();
  });
});

describe('averageKnownRiskReward', () => {
  it('ignore les R/R inconnus au lieu de les compter pour 0', () => {
    expect(averageKnownRiskReward([{ riskReward: 2 }, { riskReward: null }, { riskReward: 3 }, {}])).toBe(2.5);
  });

  it('aucun R/R connu : null, jamais 0', () => {
    expect(averageKnownRiskReward([{ riskReward: null }, {}])).toBeNull();
    expect(averageKnownRiskReward([])).toBeNull();
  });

  it('écarte les valeurs non finies', () => {
    expect(averageKnownRiskReward([{ riskReward: Number.NaN }, { riskReward: 1 }])).toBe(1);
  });
});
