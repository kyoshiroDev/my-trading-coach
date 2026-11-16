import { PREMIUM_PRICE_EUR } from '@mtc/shared';
import { FAQ } from './faq';

/**
 * Données structurées (JSON-LD). Règles :
 * - `SoftwareApplication` : page d'entrée indexable seulement (`/prop-firm`, et `/accueil` noindex
 *   tant que `/` redirige) ;
 * - `FAQPage` : UNIQUEMENT sur une page où la même FAQ est visible (`faqPage()` reçoit le tableau
 *   affiché, jamais une copie) ;
 * - les pages sans `schema` propre reçoivent `DEFAULT_SCHEMA` (Organization + WebSite) ;
 * - entités reliées par `@id` (`#organization`, `#website`) : une seule Organization pour tout le site ;
 * - `sameAs` vide tant que Greg n'a pas donné les URL des profils officiels (décision du 2026-11-16) ;
 * - jamais d'`aggregateRating` ni de `Review` tant qu'aucun avis vérifiable ne l'alimente (règles
 *   Google, pratiques commerciales trompeuses) ;
 * - prix lus dans `@mtc/shared`, jamais en dur.
 */
export const SITE = 'https://www.mytradingcoach.app';
const ORG_ID = `${SITE}/#organization`;
const WEBSITE_ID = `${SITE}/#website`;

type JsonLd = Record<string, unknown>;

export const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'MyTradingCoach',
  url: SITE,
  logo: { '@type': 'ImageObject', url: `${SITE}/icon/logo-512.png`, width: 512, height: 512 },
  contactPoint: { '@type': 'ContactPoint', email: 'support@mytradingcoach.app', contactType: 'customer support', availableLanguage: 'French' },
  address: { '@type': 'PostalAddress', addressCountry: 'FR' },
  sameAs: [],
};

export const WEBSITE = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: 'MyTradingCoach',
  url: SITE,
  inLanguage: 'fr',
  publisher: { '@id': ORG_ID },
  description: 'Journal de trading pour traders futures en prop firm, avec synchro Tradovate en lecture seule et import CSV.',
};

export const DEFAULT_SCHEMA = [ORGANIZATION, WEBSITE];

/** Référence à l'Organization du site (auteur, éditeur). */
export const ORGANIZATION_REF = { '@id': ORG_ID };

const { monthly, annual } = PREMIUM_PRICE_EUR;

export const SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'MyTradingCoach',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  // Page d'entrée réelle tant que `/` redirige en 302 vers elle (2026-11-08).
  url: `${SITE}/prop-firm`,
  publisher: ORGANIZATION_REF,
  description:
    'Journal de trading pour traders futures en prop firm : synchro Tradovate en lecture seule, marge avant la limite de la firme en direct, coach IA et débrief hebdomadaire. Outil d’analyse, pas un conseil en investissement.',
  inLanguage: 'fr',
  offers: [
    { '@type': 'Offer', name: 'Gratuit', price: '0', priceCurrency: 'EUR', description: 'Trades illimités, journal complet, 1 compte avec ses règles prop firm, synchro Tradovate, suivi prop firm en direct, compagnon de session, calendrier éco IA, news et contexte marché' },
    {
      '@type': 'Offer',
      name: 'Premium mensuel',
      price: String(monthly),
      priceCurrency: 'EUR',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(monthly), priceCurrency: 'EUR', unitCode: 'MON' },
      description: 'Tout le plan Gratuit, plus IA Insights, Chat Coach IA, Weekly Debrief, alertes prop firm en direct (objectif et payout compris, avec le son), anti-tilt, analytics avancés et comptes illimités avec leurs règles prop firm',
    },
    {
      '@type': 'Offer',
      name: 'Premium annuel',
      price: String(annual),
      priceCurrency: 'EUR',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: String(annual), priceCurrency: 'EUR', unitCode: 'ANN' },
      description: 'Le plan Premium payé à l’année',
    },
  ],
  featureList: [
    'Synchro Tradovate en lecture seule',
    'Marge avant la limite de la prop firm, en direct',
    'Journal de trading avec suivi des émotions',
    'IA Insights propulsée par Claude',
    'Weekly Debrief automatique chaque dimanche',
    'Analytics : win rate, drawdown, heatmap',
    'Hébergé en France',
  ],
};

/** FAQPage construite depuis la FAQ AFFICHÉE sur la page (texte brut). */
export function faqPage(items: readonly { question: string; answer: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

/** WebPage d'une page du site, reliée au WebSite. */
export function webPage(url: string, name: string, description: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    url,
    name,
    description,
    inLanguage: 'fr',
    isPartOf: { '@id': WEBSITE_ID },
    publisher: ORGANIZATION_REF,
  };
}

/** Fil d'Ariane : MÊMES étapes que le fil visible de la page. */
export function breadcrumb(items: readonly { name: string; url: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export const FAQ_PAGE = faqPage(FAQ);

export const HOME_SCHEMA = [SOFTWARE_APPLICATION, ORGANIZATION, WEBSITE, FAQ_PAGE];
