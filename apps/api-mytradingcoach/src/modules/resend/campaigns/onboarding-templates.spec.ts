import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOUNDER_OFFER, FOUNDER_REFUND_DAYS, PREMIUM_PRICE_EUR } from '@mtc/shared';
import { welcomeFreeTemplate } from '../templates';
import {
  connectTradovateTemplate,
  firstWeekRecapTemplate,
  founderFollowupTemplate,
  propFirmRulesTemplate,
  type CampaignBuildCtx,
} from './campaign-templates';

// Les 5 e-mails de la suite d'onboarding : règles d'écriture (un bouton, pas d'emoji dans le corps,
// pas de crypto / ICT / SMC), liens UTM, désinscription adaptée au type, valeurs de @mtc/shared.

const APP = 'https://app.test';
const ctx: CampaignBuildCtx = {
  userName: 'Alex Martin',
  appUrl: APP,
  unsubUrl: 'https://api.test/api/emails/unsubscribe?token=t&scope=service',
  propFirmCount: 16,
  firstWeek: { trades: 12, days: 4, pnl: '-$85.50' },
  seatsLeft: 154,
  seatsTotal: 200,
};

const EMAILS = {
  welcome: welcomeFreeTemplate({ userName: ctx.userName, appUrl: APP, trialEndsAt: new Date('2026-11-16T10:00:00Z') }),
  connect_tradovate: connectTradovateTemplate(ctx),
  prop_firm_rules: propFirmRulesTemplate(ctx),
  first_week_recap: firstWeekRecapTemplate({ ...ctx, unsubUrl: 'U-MKT' }),
  founder_followup: founderFollowupTemplate({ ...ctx, unsubUrl: 'U-MKT' }),
};

/** Corps de l'e-mail : entre le contenu et le pied commun (logo, adresse, drapeau). */
const body = (html: string) => html.slice(html.indexOf('<!-- CONTENU -->'), html.indexOf('<!-- FOOTER -->'));
const text = (html: string) => body(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const EMOJI = /\p{Extended_Pictographic}/gu;
const appLinks = (html: string) => [...html.matchAll(/href="(https:\/\/app\.test[^"]*)"/g)].map((m) => m[1]);
const buttons = (html: string) => (body(html).match(/padding:13px 24px;border-radius:9px/g) ?? []).length;

describe.each(Object.entries(EMAILS))('%s', (key, email) => {
  it('un seul bouton, aucun emoji dans le corps, un au plus dans le sujet', () => {
    expect(buttons(email.html)).toBe(1);
    expect(body(email.html).match(EMOJI)).toBeNull();
    expect((email.subject.match(EMOJI) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('ni crypto, ni ICT, ni SMC, ni promesse « le seul » / « le premier »', () => {
    const all = `${email.subject} ${text(email.html)}`;
    expect(all).not.toMatch(/crypto|\bICT\b|\bSMC\b|le seul|le premier\b/i);
  });

  it('tous les liens vers l’app portent utm email / onboarding / clé', () => {
    const links = appLinks(email.html);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const u = new URL(link.replace(/&amp;/g, '&'));
      expect(u.searchParams.get('utm_source'), link).toBe('email');
      expect(u.searchParams.get('utm_medium'), link).toBe('onboarding');
      expect(u.searchParams.get('utm_campaign'), link).toBe(key);
    }
  });

  it('prénom seul (premier mot du nom)', () => {
    expect(text(email.html)).toContain('Bonjour Alex');
    expect(text(email.html)).not.toContain('Martin');
  });
});

describe('contenu de chaque e-mail', () => {
  it('bienvenue : 3 étapes, bouton vers la connexion, alternative CSV, Discord sans ICT / crypto, plus de pub Premium', () => {
    const { subject, html } = EMAILS.welcome;
    expect(subject).toBe('Bienvenue sur MyTradingCoach : 3 étapes pour démarrer');
    const t = text(html);
    expect(t).toContain('Connecte ton compte Tradovate');
    expect(t).toContain('Choisis ta prop firm et ton plan');
    expect(t).toContain('Ouvre ta séance');
    expect(t).toContain('Aucun ordre n\'est jamais passé');
    expect(t).toContain('Connecter mon compte');
    expect(t).toContain('Tu ne trades pas sur Tradovate ?');
    expect(t).toContain('La communauté des utilisateurs : questions, retours, entraide.');
    expect(t).not.toMatch(/Multi-marché|Forex/);
    // Pas de pub Premium : sa seule mention est le rappel de l'essai d'inscription (#769).
    expect(text(welcomeFreeTemplate({ userName: 'Alex', appUrl: APP, trialEndsAt: null }).html)).not.toMatch(/Premium/);
    expect(t.replace(/Tu as 14 jours de Premium offerts/, '')).not.toMatch(/Premium/);
    expect(appLinks(html)[0]).toContain(`${APP}/accounts?`);
  });

  it('bienvenue : essai d’inscription annoncé avec sa date de fin, sans prélèvement (#769)', () => {
    const t = text(EMAILS.welcome.html);
    expect(t).toContain('Tu as 14 jours de Premium offerts jusqu\'au 16 novembre 2026 :');
    expect(t).toContain('sans aucun prélèvement');
  });

  it('bienvenue sans essai (réinscription récente) : aucune mention d’essai', () => {
    const t = text(welcomeFreeTemplate({ userName: 'Alex', appUrl: APP, trialEndsAt: null }).html);
    expect(t).not.toMatch(/Premium offerts|jours offerts/);
  });

  it('bienvenue : sans prénom → « Bonjour, »', () => {
    expect(text(welcomeFreeTemplate({ userName: ' ', appUrl: APP }).html)).toContain('Bonjour, ton compte est prêt');
  });

  it('e-mails de service : aucune offre payante, lien « ne plus recevoir les e-mails d’aide au démarrage »', () => {
    for (const email of [EMAILS.connect_tradovate, EMAILS.prop_firm_rules]) {
      const t = text(email.html);
      expect(t).not.toMatch(/Premium|fondateur|€|offert|essai/i);
      expect(email.html).toContain("Ne plus recevoir les e-mails d'aide au démarrage");
      expect(email.html).toContain('href="https://api.test/api/emails/unsubscribe?token=t&scope=service"');
    }
  });

  it('connect_tradovate : lecture seule, page officielle, alternative CSV', () => {
    const t = text(EMAILS.connect_tradovate.html);
    expect(EMAILS.connect_tradovate.subject).toBe('Connecte Tradovate en 2 minutes');
    expect(t).toContain('page officielle Tradovate / NinjaTrader, en lecture seule');
    expect(t).toContain('MyTradingCoach ne peut passer aucun ordre');
    expect(t).toContain('Importe ton historique en CSV');
    expect(t).toContain('Connecter mon compte Tradovate');
  });

  it('prop_firm_rules : nombre de firmes du catalogue (accord singulier / pluriel, absent si inconnu)', () => {
    expect(text(EMAILS.prop_firm_rules.html)).toContain('16 prop firms sont déjà intégrées.');
    expect(text(propFirmRulesTemplate({ ...ctx, propFirmCount: 1 }).html)).toContain('1 prop firm est déjà intégrée.');
    expect(text(propFirmRulesTemplate({ ...ctx, propFirmCount: undefined }).html)).not.toContain('intégrée');
  });

  it('first_week_recap : chiffres neutres (même ton si négatif), Premium sans essai promis (#769), mention de risque', () => {
    const t = text(EMAILS.first_week_recap.html);
    expect(EMAILS.first_week_recap.subject).toBe('Ta première semaine sur MyTradingCoach');
    expect(t).toContain('cette semaine : 12 trades, 4 jours de trading, P&amp;L -$85.50.');
    expect(t).not.toMatch(/bravo|félicit|dommage|attention/i);
    expect(t).toContain('Sans engagement, annulable en un clic.');
    expect(t).not.toMatch(/mois offert|jours offerts|carte requise/i);
    expect(t).toContain('Le trading comporte un risque de perte en capital.');
    expect(EMAILS.first_week_recap.html).toContain('href="U-MKT"');
    const singular = text(firstWeekRecapTemplate({ ...ctx, firstWeek: { trades: 1, days: 1, pnl: '+$10.00' } }).html);
    expect(singular).toContain('1 trade, 1 jour de trading');
    expect(appLinks(EMAILS.first_week_recap.html)[0]).toContain('/dashboard?plan=premium&cta=email&utm_source=');
  });

  it('founder_followup : prix et délais de @mtc/shared, compteur partagé, aucune fausse urgence', () => {
    const { subject, html } = EMAILS.founder_followup;
    const t = text(html);
    const { priceMonthlyEur: m, priceAnnualEur: y, seats } = FOUNDER_OFFER;
    expect(subject).toBe(`${m} €/mois tant que ton abonnement reste actif, pour les ${seats} premiers`);
    expect(t).toContain(`${m} €/mois tant que ton abonnement reste actif`);
    expect(t).toContain(`(ou ${y} €/an), au lieu de ${PREMIUM_PRICE_EUR.monthly} €/mois`);
    expect(t).toContain('Plus que 154 places sur 200');
    expect(t).toContain(`satisfait ou remboursé pendant ${FOUNDER_REFUND_DAYS} jours`);
    expect(t).toContain('Le trading comporte un risque de perte en capital.');
    expect(t).not.toMatch(/dernière chance|vite|plus que \d+ heures|compte à rebours|urgent/i);
    expect(appLinks(html)[0]).toContain('/dashboard?plan=founder&cta=email&utm_source=');
    // Aucune place prise : « 200 places disponibles », jamais « Plus que 200 places sur 200 »
    expect(text(founderFollowupTemplate({ ...ctx, seatsLeft: 200 }).html)).toContain('200 places disponibles');
  });
});

describe('aucun montant ni durée écrits en dur dans les modèles de la suite', () => {
  it('pas de « N € », « N jours » ni « N places » littéraux dans le code des 4 nouveaux e-mails', () => {
    const src = readFileSync(join(__dirname, 'campaign-templates.ts'), 'utf8');
    const block = src.slice(src.indexOf('// ── Suite d\'onboarding'), src.indexOf('// ── Premier trade'));
    expect(block.length).toBeGreaterThan(1000);
    expect(block).not.toMatch(/\d+\s*€|\d+\s*jours|\d+\s*places|\d+\s*premiers/);
  });
});
