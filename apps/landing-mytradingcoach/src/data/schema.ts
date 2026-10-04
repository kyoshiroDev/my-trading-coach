import { PREMIUM_PRICE_EUR } from '@mtc/shared';
import { FAQ } from './faq';

/**
 * Données structurées (JSON-LD). Règles :
 * - `SoftwareApplication` et `FAQPage` : HOME UNIQUEMENT (passés par `index.astro`) ;
 * - les autres pages sans `schema` propre reçoivent `DEFAULT_SCHEMA` (Organization + WebSite) ;
 * - jamais d'`aggregateRating` tant qu'aucun avis vérifiable ne l'alimente (règles Google,
 *   pratiques commerciales trompeuses) ;
 * - prix lus dans `@mtc/shared`, jamais en dur.
 */
const SITE = 'https://www.mytradingcoach.app';

export const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'MyTradingCoach',
  url: SITE,
  logo: `${SITE}/icon/og-image.png`,
  contactPoint: { '@type': 'ContactPoint', email: 'hello@mytradingcoach.app', contactType: 'customer support', availableLanguage: 'French' },
  address: { '@type': 'PostalAddress', addressCountry: 'FR' },
  sameAs: [],
};

export const WEBSITE = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'MyTradingCoach',
  url: SITE,
  inLanguage: 'fr',
  description: 'Journal de trading intelligent avec coach IA pour traders crypto et forex',
};

export const DEFAULT_SCHEMA = [ORGANIZATION, WEBSITE];

const monthly = String(PREMIUM_PRICE_EUR.monthly);

export const SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'MyTradingCoach',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  url: SITE,
  description: 'Journal de trading intelligent avec coach IA, tracking émotionnel et Weekly Debrief automatique.',
  inLanguage: 'fr',
  offers: [
    { '@type': 'Offer', name: 'Gratuit', price: '0', priceCurrency: 'EUR', description: 'Trades illimités, journal complet, 1 compte avec ses règles prop firm, compagnon de session, calendrier éco IA, news et contexte marché' },
    {
      '@type': 'Offer',
      name: 'Premium',
      price: monthly,
      priceCurrency: 'EUR',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: monthly, priceCurrency: 'EUR', unitCode: 'MON' },
      description: 'Tout le plan Gratuit, plus IA Insights, Chat Coach IA, Weekly Debrief, alertes prop firm en direct, anti-tilt, analytics avancés et comptes illimités avec leurs règles prop firm',
    },
  ],
  featureList: [
    'Journal de trading avec tracking émotionnel',
    'IA Insights propulsée par Claude',
    'Weekly Debrief automatique chaque dimanche',
    'Analytics avancés : win rate, drawdown, heatmap',
    'Score trader sur 5 axes de progression',
    'Hébergé en France',
  ],
};

export const FAQ_PAGE = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
};

export const HOME_SCHEMA = [SOFTWARE_APPLICATION, ORGANIZATION, WEBSITE, FAQ_PAGE];
