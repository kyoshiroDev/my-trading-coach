import { describe, it, expect } from 'vitest';
import { TRADER_PUSH_MESSAGES, traderPushPayload, type TraderPushMessage } from './trader-push-messages';
import type { PropAlertEvent } from '../integrations/tradovate/prop-alerts.service';

/** Textes des push : une phrase factuelle, sans montant, sans conseil, sans tiret cadratin. */

const prop = (over: Partial<PropAlertEvent>): PropAlertEvent => ({
  accountId: 'acc-1', accountLabel: 'Apex 50K', currency: 'USD', kind: 'drawdown', level: 'critical',
  remaining: 180.5, limit: 2500, breach: null, ...over,
});

const all = (): TraderPushMessage[] => [
  ...(['drawdown', 'daily_loss'] as const).flatMap((kind) =>
    (['critical', 'breached'] as const).map((level) => TRADER_PUSH_MESSAGES.propAlert(prop({ kind, level }))!),
  ),
  TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'consistency', level: 'breached' }))!,
  TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'objective', level: 'reached' }))!,
  TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'payout', level: 'reached' }))!,
  TRADER_PUSH_MESSAGES.tilt({ signal: 'revenge', ref: 't1', minutes: 1, accountId: 'acc-1', accountLabel: 'Apex 50K', moodStart: null }),
  TRADER_PUSH_MESSAGES.tilt({ signal: 'size', ref: 't1', quantity: 6, medianQuantity: 2.5, accountId: 'acc-1', accountLabel: 'Apex 50K', moodStart: null }),
  TRADER_PUSH_MESSAGES.tilt({ signal: 'overtrading', ref: 'd', count: 14, medianCount: 5, accountId: 'acc-1', accountLabel: 'Apex 50K', moodStart: null }),
  TRADER_PUSH_MESSAGES.behavior('acc-1', { type: 'STREAK_ENTRY', message: 'Nouvelle entrée après 3 pertes d’affilée dans la séance.' } as never),
  TRADER_PUSH_MESSAGES.recapReady(),
  TRADER_PUSH_MESSAGES.tradovateReconnect('acc-1', 'Apex 50K'),
  TRADER_PUSH_MESSAGES.test(),
];

describe('TRADER_PUSH_MESSAGES', () => {
  it('le premier seuil et l’approche de la consistency restent dans l’app', () => {
    expect(TRADER_PUSH_MESSAGES.propAlert(prop({ level: 'warning' }))).toBeNull();
    expect(TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'daily_loss', level: 'warning' }))).toBeNull();
    expect(TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'consistency', level: 'warning' }))).toBeNull();
  });

  it('règle de firm : mention « estimation MyTradingCoach », Session live, urgence selon le niveau', () => {
    const critical = TRADER_PUSH_MESSAGES.propAlert(prop({ level: 'critical' }))!;
    expect(critical).toMatchObject({ title: 'Apex 50K', url: '/session', urgency: 'high', tag: 'prop-acc-1-drawdown' });
    expect(critical.body).toContain('(estimation MyTradingCoach)');
    expect(TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'objective', level: 'reached' }))!.urgency).toBe('normal');
  });

  it('aucun montant, aucun conseil, aucun tiret cadratin', () => {
    for (const m of all()) {
      const text = `${m.title} ${m.body}`;
      expect(text).not.toMatch(/[$€£]|\d+[.,]\d{2}\b|180|2500|2 500/);
      expect(text).not.toMatch(/achète|vends|coupe ta position|ferme ta position|gagne/i);
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('médiane décimale écrite à la française', () => {
    expect(TRADER_PUSH_MESSAGES.tilt({ signal: 'size', ref: 't', quantity: 6, medianQuantity: 2.5, accountId: 'a', accountLabel: 'X', moodStart: null }).body)
      .toBe('Taille de 6 juste après une perte, ta médiane est de 2,5.');
  });

  it('payload du service worker : lien et réglages', () => {
    expect(traderPushPayload(TRADER_PUSH_MESSAGES.recapReady(), 123)).toEqual({
      title: 'Récap du jour', body: 'Ton récap du jour est prêt.', url: '/dashboard', tag: 'recap',
      timestamp: 123, settingsUrl: '/profil#notifications',
    });
  });
});
