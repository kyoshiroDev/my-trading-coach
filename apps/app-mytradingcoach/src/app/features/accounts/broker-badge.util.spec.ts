import { describe, it, expect } from 'vitest';
import { assignBrokerTones, brokerBadge, normalizeBrokerName, preferredTone } from './broker-badge.util';

const RED = /#ef4444|var\(--red\)/;
const GREEN = /#10b981|var\(--green\)/;

describe('brokerBadge', () => {
  it('pas de firm → pas de pastille', () => {
    expect(brokerBadge(null)).toBeNull();
    expect(brokerBadge(undefined)).toBeNull();
    expect(brokerBadge('')).toBeNull();
    expect(brokerBadge('   ')).toBeNull();
    expect(brokerBadge('—')).toBeNull();
  });

  it('initiales des mots significatifs, en majuscules', () => {
    expect(brokerBadge('Apex Trader Funding')?.initials).toBe('AP');
    expect(brokerBadge('Lucid Trading')?.initials).toBe('LU');
    expect(brokerBadge('FTMO')?.initials).toBe('FT');
    expect(brokerBadge('Take Profit Trader')?.initials).toBe('TP');
    expect(brokerBadge('My Funded Futures')?.initials).toBe('MF');
    expect(brokerBadge('Topstep')?.initials).toBe('TO');
    expect(brokerBadge('X')?.initials).toBe('X');
    expect(brokerBadge('Trading Funding')?.initials).toBe('TF');
  });

  it('même firm, saisie différente → même pastille', () => {
    const ref = brokerBadge('Apex Trader Funding');
    expect(brokerBadge('apex trader funding')).toEqual(ref);
    expect(brokerBadge('  APEX   Trader-Funding. ')).toEqual(ref);
    expect(brokerBadge('Lucid Tràding')).toEqual(brokerBadge('Lucid Trading'));
  });

  it('avec une attribution, la pastille prend la couleur attribuée', () => {
    const tones = assignBrokerTones(['Lucid Trading', 'FTMO']);
    expect(brokerBadge('FTMO', tones)?.color).toBe(tones.get('ftmo')?.color);
  });

  it('normalizeBrokerName', () => {
    expect(normalizeBrokerName('  Éval   Prop-Firm!! ')).toBe('eval prop firm');
  });
});

describe('assignBrokerTones : une couleur différente par prop firm', () => {
  const FIRMS = ['Apex Trader Funding', 'Lucid Trading', 'FTMO', 'Topstep', 'Tradeify', 'Take Profit Trader',
    'Bulenox', 'Alpha Futures', 'My Funded Futures', 'Earn2Trade', 'Elite Trader Funding', 'Funded Next'];

  it('Lucid et FTMO, qui ont la même couleur préférée, sont séparées', () => {
    expect(preferredTone('Lucid Trading')).toEqual(preferredTone('FTMO')); // le conflit existe bien
    const tones = assignBrokerTones(['Lucid Trading', 'FTMO']);
    expect(tones.get('lucid trading')?.color).not.toBe(tones.get('ftmo')?.color);
  });

  it('les 6 firms du catalogue ont 6 couleurs franches, sans nuances voisines', () => {
    const catalog = ['Lucid Trading', 'Apex Trader Funding', 'Topstep', 'Tradeify', 'MyFundedFutures', 'TradeDay'];
    const colors = [...assignBrokerTones(catalog).values()].map((t) => t.color);
    expect(new Set(colors).size).toBe(6);
    expect(colors).not.toContain('#e879f9'); // fuchsia, trop proche du rose
  });

  it('teintes générées : au moins 25° d\'écart entre elles', () => {
    const hues = [...assignBrokerTones(FIRMS).values()]
      .map((t) => Number(/^hsl\((\d+)/.exec(t.color)?.[1] ?? NaN)).filter((h) => !Number.isNaN(h));
    for (const a of hues) for (const b of hues) if (a !== b) expect(Math.min(Math.abs(a - b), 360 - Math.abs(a - b))).toBeGreaterThanOrEqual(25);
  });

  it('jamais deux firms avec la même couleur, quel que soit leur nombre (12 > 6 teintes)', () => {
    for (let n = 1; n <= FIRMS.length; n++) {
      const tones = assignBrokerTones(FIRMS.slice(0, n));
      expect(new Set([...tones.values()].map((t) => t.color)).size).toBe(n);
    }
  });

  it('jamais de rouge ni de vert, même pour les teintes générées', () => {
    for (const t of assignBrokerTones(FIRMS).values()) {
      expect(t.color).not.toMatch(RED);
      expect(t.color).not.toMatch(GREEN);
      const hue = /^hsl\((\d+)/.exec(t.color)?.[1];
      if (hue) expect(Number(hue) >= 40 && Number(hue) <= 60 || Number(hue) >= 180 && Number(hue) <= 330).toBe(true);
    }
  });

  it('la firm la plus ancienne garde sa couleur : ajouter une firm ne recolore pas les autres', () => {
    const before = assignBrokerTones(['Lucid Trading']);
    const after = assignBrokerTones(['Lucid Trading', 'FTMO']);
    expect(after.get('lucid trading')).toEqual(before.get('lucid trading'));
    expect(after.get('lucid trading')).toEqual(preferredTone('Lucid Trading'));
  });

  it('plusieurs comptes de la même firm (saisies différentes) → une seule couleur', () => {
    const tones = assignBrokerTones(['Apex Trader Funding', 'apex trader funding', 'APEX Trader-Funding', 'FTMO']);
    expect(tones.size).toBe(2);
  });

  it('sans conflit, chaque firm garde sa couleur préférée (identique pour tous les utilisateurs)', () => {
    const tones = assignBrokerTones(['Apex Trader Funding']);
    expect(tones.get('apex trader funding')).toEqual(preferredTone('Apex Trader Funding'));
  });
});
