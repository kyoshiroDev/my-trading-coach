/**
 * Tri des annonces FMP à la manière de ForexFactory (fonctions pures).
 *
 * FMP classe « High/Medium » bien plus large que FF : ~90 annonces par semaine (CFTC,
 * taux MBA, Brésil, Turquie…) contre une dizaine chez FF. On ne garde que les 9 devises
 * suivies par FF, on retire le bruit, et l'impact « fort » vient de NOS règles (NFP, CPI,
 * taux directeurs…) au lieu du classement FMP. Le reste qu'FMP juge High/Medium = moyen.
 */

export type EcoImpact = 'high' | 'medium';

/** Devises couvertes par ForexFactory. */
export const MAJOR_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY']);

/** Zone euro : seuls l'agrégat et les deux plus grosses économies bougent l'EUR. */
const EUR_COUNTRIES = new Set(['EU', 'EA', 'EMU', 'DE', 'FR']);

/** Bruit retiré quel que soit le classement FMP. */
const NOISE: RegExp[] = [
  /\bCFTC\b/i,
  /\bMBA\b|mortgage/i,
  /auction/i,
  /redbook/i,
  /\bAPI\b.*(crude|stock|inventor)/i,
  /rig count|baker hughes/i,
  /house price|housing prices?|\bHPI\b|\bRICS\b/i,
  /current account/i,
  /\bAi Group\b|westpac/i,
  /leading (index|indicators?|economic)/i,
  /\bsentix\b/i,
  /capacity utili[sz]ation/i,
  /(wholesale|retail|business) inventories/i,
  /factory orders/i,
  /\bEIA\b.*(gasoline|distillate|natural gas|refinery|heating)/i,
  /natural gas (storage|stocks)/i,
  /budget|treasury statement/i,
  /bank holiday|holiday/i,
  // Détail d'une annonce déjà affichée, ou statistique que FF classe faible
  /^(exports|imports)\b/i,
  /construction (PMI|output)/i,
  /credit conditions/i,
  /\bWASDE\b/i,
  /household spending/i,
  /participation rate|(full|part)[- ]time employment/i,
  /continuing (jobless )?claims|4-week average/i,
];

/** Gouverneurs et présidents de banque centrale : leurs discours sont forts. */
const GOVERNORS = /powell|fed chair|lagarde|ECB president|bailey|ueda|macklem|bullock|\borr\b|schlegel|breman/i;

/** Discours des autres membres (Fed régionales, Bundesbank, MPC…) : faibles chez FF. */
const SPEECH = /speech|speaks|testimony|remarks/i;

/** Catégories gardées seulement pour les devises où FF les classe au moins moyennes. */
const KEEP_ONLY_FOR: { re: RegExp; ccy: string[] }[] = [
  { re: /balance of trade|trade balance/i, ccy: ['CNY'] },
  { re: /industrial production|manufacturing production/i, ccy: ['GBP', 'CNY'] },
  { re: /^retail sales/i, ccy: ['USD', 'GBP', 'CAD', 'AUD', 'NZD', 'CNY'] },
  { re: /unemployment rate|claimant count/i, ccy: ['USD', 'CAD', 'AUD', 'NZD', 'GBP'] },
  { re: /consumer (confidence|sentiment)/i, ccy: ['USD', 'GBP'] },
];

/**
 * Rendez-vous hebdo/mensuels que FF affiche toujours en moyen : gardés même si FMP les classe
 * Low. Sinon une annonce vue Low au premier fetch n'est jamais stockée, et une ligne déjà
 * stockée n'est plus resynchronisée (son résultat ne remonterait pas).
 */
const ALWAYS_MEDIUM: { re: RegExp; ccy: string }[] = [
  { re: /michigan|\bUoM\b/i, ccy: 'USD' }, // sentiment + anticipations d'inflation
  { re: /^initial jobless claims|^unemployment claims/i, ccy: 'USD' },
  { re: /ISM (services|non-manufacturing)/i, ccy: 'USD' },
  { re: /\bEIA\b.*crude/i, ccy: 'USD' },
  { re: /\bIvey\b/i, ccy: 'CAD' },
];

interface HighRule {
  re: RegExp;
  /** Devises concernées ; absent = toutes les majeures. */
  ccy?: string[];
}

/** Annonces fortes, au sens ForexFactory. */
const HIGH: HighRule[] = [
  // Emploi
  { re: /non[- ]?farm (payrolls|employment)/i, ccy: ['USD'] },
  { re: /^ADP\b/i, ccy: ['USD'] },
  { re: /average (hourly )?earnings/i, ccy: ['USD', 'GBP'] },
  { re: /JOLTS|job openings/i, ccy: ['USD'] },
  { re: /unemployment rate/i, ccy: ['USD', 'CAD', 'AUD', 'NZD'] },
  { re: /^(net )?employment change/i, ccy: ['CAD', 'AUD', 'NZD'] },
  // Inflation (pas les sous-indices JPY/CNY, moyens chez FF)
  { re: /^(core )?(CPI|HICP|inflation rate)\b|consumer price index/i, ccy: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD'] },
  { re: /^core PCE|^PCE price index/i, ccy: ['USD'] },
  // Croissance & conso
  // PIB trimestriel (pas le déflateur, ni le GDPNow d'Atlanta, ni le YoY, faibles chez FF)…
  { re: /^(GDP|gross domestic product)\b(?!.*(price|deflator|YoY))/i, ccy: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY'] },
  // …sauf la Chine, qui ne publie que le YoY.
  { re: /^(GDP|gross domestic product)\b(?!.*(price|deflator))/i, ccy: ['CNY'] },
  { re: /^retail sales/i, ccy: ['USD', 'GBP', 'CAD', 'AUD', 'NZD'] },
  { re: /ISM manufacturing/i, ccy: ['USD'] },
  { re: /^CB consumer confidence/i, ccy: ['USD'] },
  // Banques centrales : décisions, communiqués, minutes FOMC
  { re: /rate decision|federal funds rate|official bank rate|cash rate|overnight rate|policy rate|refinancing rate|deposit (facility )?rate|\bOCR\b/i },
  { re: /\bFOMC\b(?!.*member)/i, ccy: ['USD'] },
  { re: /monetary policy (statement|summary|report)|rate statement|press conference|economic projections/i },
  // Gouverneurs (les discours des autres membres sont écartés)
  { re: GOVERNORS },
];

/** Nom FMP sans le suffixe de période : « Inflation Rate YoY (Sep) » → « Inflation Rate YoY ». */
function baseName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Les ancrages `^` portent sur le libellé sans préfixe d'institution (« ECB », « BoE »…) ni « Prelim/Flash ». */
function withoutPrefix(name: string): string {
  return name.replace(/^((fed|ECB|BoE|BoJ|BoC|RBA|RBNZ|SNB|PBoC|S&P Global|HCOB)\s+)?((prelim(inary)?|flash|final|advance)\s+)?/i, '');
}

export interface ClassifyInput {
  name: string;
  currency: string;
  country?: string | null;
  /** Classement FMP brut : 'High' | 'Medium' | 'Low' | ''. */
  fmpImpact: string;
}

/** Impact retenu, ou `null` si l'annonce ne figure pas dans le calendrier. */
export function classifyEcoEvent({ name, currency, country, fmpImpact }: ClassifyInput): EcoImpact | null {
  const ccy = currency?.toUpperCase();
  if (!MAJOR_CURRENCIES.has(ccy)) return null;

  const base = baseName(name);
  if (NOISE.some((re) => re.test(base))) return null;
  if (SPEECH.test(base) && !GOVERNORS.test(base)) return null;

  const stripped = withoutPrefix(base);
  if (KEEP_ONLY_FOR.some((r) => r.re.test(stripped) && !r.ccy.includes(ccy))) return null;
  // Un fort passe même si FMP le classe Low (ex. certaines minutes FOMC).
  const isHigh = HIGH.some((r) => (!r.ccy || r.ccy.includes(ccy)) && (r.re.test(stripped) || r.re.test(base)));
  const cc = country?.toUpperCase();
  if (ccy === 'EUR' && cc && !EUR_COUNTRIES.has(cc)) return null; // Italie, Espagne… : FF les classe faibles
  // CPI ou PIB allemand/français : moyens chez FF, seul l'agrégat zone euro est fort
  // (la BCE et Lagarde sont publiés sous le pays EU).
  if (isHigh) return ccy === 'EUR' && (cc === 'DE' || cc === 'FR') ? 'medium' : 'high';
  if (ALWAYS_MEDIUM.some((r) => r.ccy === ccy && r.re.test(stripped))) return 'medium';
  return fmpImpact === 'High' || fmpImpact === 'Medium' ? 'medium' : null;
}
