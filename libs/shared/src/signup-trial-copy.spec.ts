import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

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

  it('réservation fondateur pendant l’essai (#769, B1) : tarifs, /prop-firm, FAQ et CGU l’annoncent', () => {
    for (const f of ['components/Pricing.astro', 'components/prop-firm-page/PfPricing.astro']) {
      expect(read(`apps/landing-mytradingcoach/src/${f}`)).toContain('Paiement à la fin de tes {PREMIUM_SIGNUP_TRIAL_DAYS} jours offerts');
    }
    expect(read('apps/landing-mytradingcoach/src/data/faq.ts')).toContain('tu peux réserver ta place');
    const cgu = read('apps/landing-mytradingcoach/src/pages/cgu.astro');
    expect(cgu).toContain('avec un premier prélèvement à la fin de cette période');
    expect(cgu).toContain('suivant le premier paiement effectivement prélevé');
  });
});

// Typographie (#769, C4) : espace insécable avant « : ; ! ? » dans les textes ajoutés pour la réservation
// fondateur et les e-mails de l'essai (`&nbsp;` dans le HTML, `\u00a0` dans les chaînes). Les gabarits
// plus anciens ne sont pas concernés. Les chaînes sont lues par le compilateur TypeScript : rien ne
// passe entre les gouttes (gabarits imbriqués, chaînes concaténées).
describe('Typographie des textes de l’essai et de la réservation (#769)', () => {
  /** Chaînes du fichier (les ${…} remplacés par X, balises HTML retirées), limitées aux fonctions citées. */
  function literals(file: string, functions?: string[]): string[] {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const visit = (node: ts.Node, inside: boolean): void => {
      const named = ts.isFunctionDeclaration(node) && node.name && functions?.includes(node.name.text);
      const take = inside || !functions || !!named;
      if (take && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) out.push(node.text);
      if (take && ts.isTemplateExpression(node)) out.push([node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('X'));
      ts.forEachChild(node, (child) => visit(child, take));
    };
    visit(sf, false);
    return out.map((t) => t.replace(/<[^>]*>/g, ' '));
  }
  /** Espace ordinaire avant : ; ! ? (ou ponctuation en début de ligne) : la faute cherchée. */
  const faults = (texts: string[]) => texts.filter((t) => /\S[ \t]+[:;!?](?=\s|$)/.test(t) || /\n[ \t]*[:;!?](?=\s)/.test(t));

  it('e-mails réservation, 3D Secure, J+11 et fin d’essai', () => {
    const mails = [
      ...literals('apps/api-mytradingcoach/src/modules/resend/templates/index.ts', ['founderReservationTemplate', 'paymentActionRequiredTemplate']),
      ...literals('apps/api-mytradingcoach/src/modules/resend/campaigns/campaign-templates.ts', ['trialEndingTemplate', 'trialEndedTemplate']),
    ];
    expect(mails.join(' ')).toContain('depuis ton profil'); // les fonctions ont bien été trouvées
    expect(mails.join(' ')).toContain('Ce qui change en gratuit');
    expect(faults(mails)).toEqual([]);
  });

  it('page de paiement et FAQ : textes de la réservation', () => {
    const reservation = /Aucun prélèvement avant le|tu ne paies rien|tu peux réserver ta place|à partir du premier paiement/;
    const texts = [
      ...literals('apps/app-mytradingcoach/src/app/features/checkout/checkout-copy.ts'),
      ...literals('apps/landing-mytradingcoach/src/data/faq.ts'),
    ].filter((t) => reservation.test(t));
    expect(texts.length).toBeGreaterThanOrEqual(4);
    expect(faults(texts)).toEqual([]);
  });

  it('CGU fondateur : lignes de la réservation', () => {
    const cgu = read('apps/landing-mytradingcoach/src/pages/cgu.astro')
      .split('\n')
      .filter((l) => l.includes('avec un premier prélèvement à la fin de cette période') || l.includes('suivant le premier paiement effectivement prélevé'))
      .map((l) => l.replace(/<[^>]*>/g, ' '));
    expect(cgu).toHaveLength(2);
    expect(faults(cgu)).toEqual([]);
  });
});
