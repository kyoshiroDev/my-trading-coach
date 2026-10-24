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
  TRADER_PUSH_MESSAGES.tradovateReconnect('acc-1'),
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
    expect(critical).toMatchObject({ title: '{compte}', url: '/session', urgency: 'high', tag: 'prop-acc-1-drawdown' });
    expect(critical.body).toContain('(estimation MyTradingCoach)');
    expect(TRADER_PUSH_MESSAGES.propAlert(prop({ kind: 'objective', level: 'reached' }))!.urgency).toBe('normal');
  });

  it('chaque message de règle de firm porte la mention d’estimation, en direct comme en fond (revue m4)', () => {
    const firm = [
      ...(['drawdown', 'daily_loss'] as const).flatMap((kind) => (['critical', 'breached'] as const).map((level) => ({ kind, level }))),
      { kind: 'consistency' as const, level: 'breached' as const },
      { kind: 'objective' as const, level: 'reached' as const },
      { kind: 'payout' as const, level: 'reached' as const },
    ];
    for (const background of [false, true]) {
      for (const f of firm) {
        expect(TRADER_PUSH_MESSAGES.propAlert(prop(f), { background })!.body, `${f.kind} ${f.level}`).toContain('(estimation MyTradingCoach)');
      }
    }
    for (const type of ['A1_SIZE_OVER_PLAN', 'A2_DAILY_LOSS_DISTANCE', 'A3_ENTRY_DAY_STARTED']) {
      expect(TRADER_PUSH_MESSAGES.behavior('a', { type, message: 'Règle du plan.' } as never).body).toBe('Règle du plan (estimation MyTradingCoach).');
    }
    expect(TRADER_PUSH_MESSAGES.behavior('a', { type: 'B_REVENGE', message: 'Entrée rapide.' } as never).body).toBe('Entrée rapide.');
  });

  it('aucun montant, aucun conseil, aucun tiret cadratin', () => {
    for (const m of all()) {
      const text = `${m.title} ${m.body}`;
      expect(text).not.toMatch(/[$€£]|\d+[.,]\d{2}\b|180|2500|2 500/);
      expect(text).not.toMatch(/achète|vends|coupe ta position|ferme ta position|gagne/i);
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('une phrase en direct ; deux pour un relevé de fond, la seconde annonce le décalage (décision m5)', () => {
    const sentences = (t: string) => t.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;
    for (const m of all()) expect(sentences(m.body), m.body).toBe(1);
    const bg = TRADER_PUSH_MESSAGES.propAlert(prop({ level: 'breached' }), { background: true })!;
    expect(sentences(bg.body)).toBe(2);
    expect(bg.body.endsWith('Relevé automatique, jusqu’à 15 min de décalage.')).toBe(true);
  });

  it('le libellé saisi par le trader n’entre jamais dans un texte : repère {compte} seulement', () => {
    const typed = 'Jean Dupont 0612345678';
    const msgs = [
      TRADER_PUSH_MESSAGES.propAlert(prop({ accountLabel: typed }))!,
      TRADER_PUSH_MESSAGES.tilt({ signal: 'revenge', ref: 't', accountId: 'a', accountLabel: typed, moodStart: null }),
      TRADER_PUSH_MESSAGES.tradovateReconnect('a'),
    ];
    for (const m of msgs) {
      expect(`${m.title} ${m.body}`).not.toContain('Jean');
      expect(`${m.title} ${m.body}`).toContain('{compte}');
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
