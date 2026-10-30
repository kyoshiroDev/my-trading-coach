import { describe, it, expect } from 'vitest';
import { PLAN_BENEFITS } from '@mtc/shared';
import { welcomePremiumTemplate } from './templates';
import { premiumTemplate } from './campaigns/campaign-templates';

// Les e-mails qui décrivent Premium ne vendent que ce que Premium donne vraiment (plans.md) :
// liste partagée PLAN_BENEFITS, rien de gratuit présenté comme Premium (calendrier éco, import CSV).

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');

describe('e-mails Premium : avantages réels', () => {
  it('bienvenue Premium : exactement la liste partagée, sans fonction gratuite ni non livrée', () => {
    const t = text(welcomePremiumTemplate({ userName: 'Alex', isTrial: true, appUrl: 'https://app.test' }).html);
    for (const b of PLAN_BENEFITS.premium) expect(t, b.id).toContain(b.text.replace(/\s+/g, ' '));
    expect(t).not.toMatch(/Calendrier économique|Trades illimités|Export PDF|crypto/i);
  });

  it('« Passe à Premium » : plus d’import CSV (gratuit) présenté comme Premium', () => {
    const t = text(premiumTemplate({ userName: 'Alex', appUrl: 'https://app.test', unsubUrl: 'U' }).html);
    expect(t).not.toMatch(/import CSV/i);
    expect(t).toContain('alertes avant ta limite de perte');
  });

  it('« Passe à Premium » : aucun essai promis (tout inscrit a déjà eu ses jours offerts, #769)', () => {
    const mail = premiumTemplate({ userName: 'Alex', appUrl: 'https://app.test', unsubUrl: 'U' });
    expect(text(mail.html)).toContain('Sans engagement, annulable en un clic.');
    expect(`${mail.subject} ${text(mail.html)}`).not.toMatch(/mois offert|jours offerts|carte requise/i);
  });

  it('« Passe à Premium » : bouton « Découvrir Premium », plus « Essayer » (aucun essai promis, #792)', () => {
    const t = text(premiumTemplate({ userName: 'Alex', appUrl: 'https://app.test', unsubUrl: 'U' }).html);
    expect(t).toContain('Découvrir Premium →');
    expect(t).not.toMatch(/Essayer/i);
  });
});
