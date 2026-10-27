import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Garde (#769) : la landing annonce l'essai d'inscription (PREMIUM_SIGNUP_TRIAL_DAYS), plus l'essai
// Stripe de 30 jours ni « 1 mois offert ». Seul le mois offert au PARRAIN (parrainage) reste.
const root = resolve(import.meta.dirname, '../../..');
const landing = resolve(root, 'apps/landing-mytradingcoach/src');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'content' ? [] : files(p); // articles de blog : hors offre
    return /\.(astro|ts)$/.test(name) ? [p] : [];
  });
}

/** Parrainage : le parrain gagne toujours un mois offert, ce n'est pas l'essai. */
const REFERRAL = new Set(['components/Referral.astro', 'pages/ambassadeur.astro']);

describe('Landing : essai Premium d’inscription (#769)', () => {
  const sources = files(landing).map((p) => ({ file: relative(landing, p), src: readFileSync(p, 'utf8') }));

  it('plus d’essai de 30 jours ni de « 1 mois offert » hors parrainage', () => {
    const hits = sources
      .filter(({ file }) => !REFERRAL.has(file))
      .filter(({ src }) => /1 mois offert|mois d'essai|essai de 30|30 jours d'essai|30&nbsp;jours d'essai|<strong>30 jours<\/strong>|carte requise/i.test(src))
      .map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it('durée de l’essai jamais écrite à la main (constante PREMIUM_SIGNUP_TRIAL_DAYS)', () => {
    const hits = sources.filter(({ src }) => /\b14\s*(jours|&nbsp;jours)\s+(de Premium|offerts)/i.test(src)).map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it.each([
    ['tarifs', 'apps/landing-mytradingcoach/src/components/Pricing.astro'],
    ['/prop-firm', 'apps/landing-mytradingcoach/src/components/prop-firm-page/PfPricing.astro'],
  ])('bouton « Essayer Premium » des %s : jours offerts, sans carte, URL plan=premium conservée', (_where, file) => {
    const src = read(file);
    expect(src).toContain('Essayer Premium · {PREMIUM_SIGNUP_TRIAL_DAYS} jours offerts');
    expect(src).toContain('${APP_URL}/register?plan=premium');
    expect(src).toContain('Sans carte · puis Gratuit, sans engagement');
  });

  it('politique de confidentialité : données de l’essai, comparaison 90 jours, trace d’un compte supprimé', () => {
    const page = read('apps/landing-mytradingcoach/src/pages/politique-confidentialite.astro');
    expect(page).toContain('Premium offert&nbsp;: date de fin de la période offerte');
    expect(page).toContain("l'adresse e-mail d'un compte supprimé depuis moins de 90 jours est comparée");
    expect(page).toContain('Nom et adresse e-mail effacés automatiquement 90 jours après la suppression');
  });

  it('CGU : une seule période offerte par personne, pas d’essai Stripe ensuite', () => {
    const cgu = read('apps/landing-mytradingcoach/src/pages/cgu.astro');
    expect(cgu).toContain('Cette période est accordée une fois par personne');
    expect(cgu).toContain("un abonnement payant n'a pas de période d'essai supplémentaire");
  });
});
