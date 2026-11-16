/**
 * S1 (#1063) : le nom saisi à l'inscription (sans borne) était inséré tel quel dans le HTML des
 * e-mails. L'aperçu admin d'une campagne affiche ce HTML (nom du 1er destinataire réel) : un nom
 * `<img src=x onerror=…>` exécutait du code dans l'admin et pouvait voler le jeton admin.
 * Tous les gabarits échappent désormais le nom.
 */
import { describe, it, expect } from 'vitest';
import * as T from './index';
import { CAMPAIGNS } from '../campaigns/campaign-registry';

const EVIL = '<img/src=x/onerror=alert(1)>';
const d = new Date('2026-12-01T10:00:00Z');

const transactional: [string, () => { html: string }][] = [
  ['debriefReady', () => T.debriefReadyTemplate({ userName: EVIL, weekNumber: 46, winRate: 50, totalPnl: 10, totalTrades: 2, currency: 'USD', appUrl: 'https://app' })],
  ['dailyRecap', () => T.dailyRecapTemplate({ userName: EVIL, date: d, pnl: 10, winRate: 50, tradesCount: 2, aiOneLiner: null, currency: 'USD', appUrl: 'https://app' })],
  ['welcomeFree', () => T.welcomeFreeTemplate({ userName: EVIL, appUrl: 'https://app', trialEndsAt: d })],
  ['welcomePremium', () => T.welcomePremiumTemplate({ userName: EVIL, isTrial: false, appUrl: 'https://app' })],
  ['resetPassword', () => T.resetPasswordTemplate({ userName: EVIL, resetUrl: 'https://app/r', expiresIn: '1 h' })],
  ['resetPassword Google', () => T.resetPasswordTemplate({ userName: EVIL, resetUrl: 'https://app/r', expiresIn: '1 h', googleOnly: true })],
  ['paymentFailed', () => T.paymentFailedTemplate({ userName: EVIL, attemptCount: 1, portalUrl: 'https://p' })],
  ['paymentSucceeded', () => T.paymentSucceededTemplate({ userName: EVIL, amount: '49,00 €', appUrl: 'https://app' })],
  ['subscriptionCanceled', () => T.subscriptionCanceledTemplate({ userName: EVIL, resubscribeUrl: 'https://app' })],
  ['renewalReminder', () => T.renewalReminderTemplate({ userName: EVIL, expiresAt: d, portalUrl: 'https://p' })],
  ['founderWelcome', () => T.founderWelcomeTemplate({ userName: EVIL, number: 3, priceLabel: '29 €', refundUntil: d, appUrl: 'https://app' })],
  ['founderReservation', () => T.founderReservationTemplate({ userName: EVIL, number: 3, priceLabel: '29 €', firstChargeAt: d, appUrl: 'https://app' })],
  ['paymentActionRequired', () => T.paymentActionRequiredTemplate({ userName: EVIL, invoiceUrl: 'https://i' })],
  ['partnerWelcome', () => T.partnerWelcomeTemplate({ userName: EVIL, code: 'ABC', priceLabel: '29 €', normalPriceLabel: '49 €', durationMonths: 3, trialEndsAt: null, appUrl: 'https://app' })],
  ['tariffAtRisk', () => T.tariffAtRiskTemplate({ userName: EVIL, kind: 'founder', priceLabel: '29 €', attemptCount: 1, portalUrl: 'https://p' })],
  ['annualRenewalReminder', () => T.annualRenewalReminderTemplate({ userName: EVIL, amount: '290 €', renewalDate: d, keptTariff: null, portalUrl: 'https://p' })],
];

describe('nom de l’utilisateur échappé dans tous les e-mails (S1 #1063)', () => {
  it.each(transactional)('%s', (_, build) => {
    const { html } = build();
    expect(html).not.toContain('<img/src=x');
    expect(html).toContain('&lt;img/src=x/onerror=alert(1)&gt;');
  });

  it.each(CAMPAIGNS.map((c) => [c.key, c] as const))('campagne %s', (_, campaign) => {
    const { html } = campaign.build({
      userName: EVIL, appUrl: 'https://app', unsubUrl: 'https://u', seatsLeft: 10, seatsTotal: 100,
      propFirmCount: 12, firstWeek: { trades: 3, days: 2, pnl: '+10 $' }, trial: { endsAt: d },
    });
    expect(html).not.toContain('<img/src=x');
  });

  it('nom avec « & » : échappé une seule fois (jamais « &amp;amp; »)', () => {
    const notice = CAMPAIGNS.find((c) => c.key === 'legal_notice');
    for (const c of [notice, ...CAMPAIGNS].filter(Boolean)) {
      const { html } = c!.build({
        userName: 'Jean&Co', appUrl: 'https://app', unsubUrl: 'https://u', seatsLeft: 1, seatsTotal: 1,
        propFirmCount: 1, firstWeek: { trades: 1, days: 1, pnl: '0' }, trial: { endsAt: d },
      });
      expect(html).not.toContain('&amp;amp;');
    }
  });
});
