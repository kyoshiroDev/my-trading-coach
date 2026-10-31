import { describe, it, expect } from 'vitest';
import { partnerWelcomeTemplate } from './templates';
import { founderFollowupTemplate, trialEndedTemplate, trialEndingTemplate } from './campaigns/campaign-templates';
import { CAMPAIGNS_BY_KEY } from './campaigns/campaign-registry';

// Textes de l'essai (#769) : espace insécable avant « : ; ! ? » (&nbsp; dans le HTML, \u00a0 ailleurs).
// Une espace ordinaire avant la ponctuation laisse le signe seul en début de ligne.

const ctx = { userName: 'Alex', appUrl: 'https://app.test', unsubUrl: 'https://api.test/u?token=t', seatsLeft: 154, seatsTotal: 200 };
/** Texte visible : sans bloc <style> ni balises (les « : » du CSS ne comptent pas). */
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, '\u00a0');
const plainBeforePunct = (text: string) => text.match(/[^\s\u00a0] [:;!?](?=\s|$)/g) ?? [];

describe('textes de l’essai : espace insécable avant la ponctuation', () => {
  it('e-mail de code partenaire avec essai : « Essai gratuit jusqu’au …&nbsp;: aucun prélèvement avant »', () => {
    const { html } = partnerWelcomeTemplate({
      userName: 'Alex', code: 'TRADER10', priceLabel: '29,00 € par mois', normalPriceLabel: '49,00 € par mois',
      durationMonths: null, trialEndsAt: new Date('2026-11-12T08:00:00Z'), appUrl: 'https://app.test',
    });
    expect(html).toMatch(/Essai gratuit jusqu’au [^<]+&nbsp;: aucun prélèvement avant\./);
  });

  it('relance fondateur : « Pas d’essai sur cette offre&nbsp;: »', () => {
    expect(founderFollowupTemplate(ctx).html).toContain("Pas d'essai sur cette offre&nbsp;: satisfait ou remboursé");
  });

  it.each([
    ['J+11', trialEndingTemplate({ ...ctx, trial: { endsAt: new Date('2026-11-12T08:00:00Z') } }).html],
    ['fin d’essai', trialEndedTemplate(ctx).html],
  ])('e-mail %s : aucune espace ordinaire avant « : ; ! ? » dans le texte visible', (_l, html) => {
    expect(plainBeforePunct(visible(html))).toEqual([]);
  });

  it.each(['trial_ending', 'trial_ended'])('description de campagne %s (admin) : « Service\\u00a0: »', (key) => {
    const description = CAMPAIGNS_BY_KEY.get(key)?.description ?? '';
    expect(description.startsWith('Service\u00a0: ')).toBe(true);
    expect(plainBeforePunct(description)).toEqual([]);
  });
});
