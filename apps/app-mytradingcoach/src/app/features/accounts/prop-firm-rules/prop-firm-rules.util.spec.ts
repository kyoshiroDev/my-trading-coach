import { describe, it, expect } from 'vitest';
import type { PropFirmPhaseRules } from '@mtc/shared';
import { breachLabel, parisTime, contractsLabel, enforcementLabel, lockLabel, pctLabel, scheduleLabel, tierRange, timeLabel, yesNo } from './prop-firm-rules.util';

describe('prop-firm-rules.util', () => {
  describe('heure de Paris (changements d’heure automatiques)', () => {
    // Midi UTC : le jour est le même à New York et à Paris.
    const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

    it('été et hiver alignés : 6 h d’écart', () => {
      expect(parisTime('16:59', 'America/New_York', on('2026-07-01'))).toBe('22:59');
      expect(parisTime('16:59', 'America/New_York', on('2026-12-01'))).toBe('22:59');
    });

    it('fin octobre : Paris est passé à l’heure d’hiver, New York pas encore (5 h)', () => {
      expect(parisTime('16:59', 'America/New_York', on('2026-10-28'))).toBe('21:59');
      expect(parisTime('16:59', 'America/New_York', on('2026-11-02'))).toBe('22:59');
    });

    it('mi-mars : New York est passé à l’heure d’été, Paris pas encore (5 h)', () => {
      expect(parisTime('16:45', 'America/New_York', on('2026-03-15'))).toBe('21:45');
      expect(parisTime('16:45', 'America/New_York', on('2026-04-01'))).toBe('22:45');
    });

    it('timeLabel : heure de Paris seule', () => {
      expect(timeLabel('16:59 America/New_York', on('2026-07-01'))).toBe('22:59');
      expect(timeLabel('16:59 America/New_York', on('2026-10-28'))).toBe('21:59');
      expect(timeLabel('18:00 America/New_York', on('2026-10-28'))).toBe('23:00');
      expect(timeLabel('09:00 Europe/Paris', on('2026-07-01'))).toBe('09:00');
    });
  });

  it('pctLabel', () => {
    expect(pctLabel(0.5)).toBe('50 %');
    expect(pctLabel(0.4)).toBe('40 %');
  });

  it('lockLabel : seuil figé, déclencheur, ou rien', () => {
    expect(lockLabel(50_100, 52_100, 'USD')).toBe('Se fige à $50,100 quand le solde atteint $52,100');
    expect(lockLabel(null, null, 'USD')).toBeNull();
  });

  it('enforcementLabel : non documenté = prudence affichée', () => {
    const dd = { amount: 2000, type: 'trailing_eod', trails_on: 'balance', locks_at: null, basis_notes: null } as PropFirmPhaseRules['max_drawdown'];
    expect(enforcementLabel({ ...dd, enforced_on: 'equity_realtime' })).toMatch(/temps réel sur l'equity/);
    expect(enforcementLabel({ ...dd, enforced_on: null })).toMatch(/non documenté/);
  });

  it('breachLabel : pause jusqu’au reset ou échec du compte', () => {
    expect(breachLabel({ amount: 1000, basis: 'equity', resets_at: '18:00 America/New_York', breach: 'trading_paused_for_day' }))
      .toMatch(/^Dépasser cette perte suspend le trading jusqu'à \d\d:00 \(heure de Paris\), le compte reste actif$/);
    expect(breachLabel({ amount: 1000, basis: null, resets_at: null, breach: 'account_failed' })).toBe('Dépasser cette perte fait échouer le compte');
  });

  it('tierRange / contractsLabel / yesNo', () => {
    expect(tierRange(6000, null, 'USD')).toBe('$6,000 et plus');
    expect(tierRange(0, 1499, 'USD')).toBe('$0 à $1,499');
    expect(contractsLabel({ minis: 4, micros: 40, scaling: false, notes: null })).toBe('4 minis · 40 micros');
    expect(contractsLabel({ minis: null, micros: null, scaling: false, notes: null })).toBeNull();
    expect(yesNo(null)).toBe('non documenté');
  });

  describe('scheduleLabel (plafonds par numéro de payout)', () => {
    it('toutes égales → montant seul', () => {
      expect(scheduleLabel([1000, 1000, 1000], 'USD', 6)).toBe('$1,000');
    });

    it('tableau couvrant tous les payouts (Apex, 6 sur 6) : pas de « puis »', () => {
      expect(scheduleLabel([1500, 1500, 2000, 2500, 2500, 3000], 'USD', 6)).toBe(
        'P1 $1,500 · P2 $1,500 · P3 $2,000 · P4 $2,500 · P5 $2,500 · P6 $3,000',
      );
    });

    it('null = sans plafond (Apex Legacy : 5 payouts plafonnés, libres ensuite)', () => {
      expect(scheduleLabel([2000, 2000, 2000, 2000, 2000, null], 'USD', null)).toBe(
        'P1 $2,000 · P2 $2,000 · P3 $2,000 · P4 $2,000 · P5 $2,000 · P6 et suivants sans plafond',
      );
    });

    it('payouts au-delà du tableau (LucidPro, 2 valeurs pour 5 payouts) : la dernière vaut ensuite', () => {
      expect(scheduleLabel([2000, 2500], 'USD', 5)).toBe('P1 $2,000 · P2 et suivants $2,500');
      expect(scheduleLabel([3000, 2500], 'USD', null)).toBe('P1 $3,000 · P2 et suivants $2,500');
    });
  });
});
