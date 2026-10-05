import { describe, it, expect } from 'vitest';
import { classifyEcoEvent, type ClassifyInput } from './eco-calendar.impact';

const c = (name: string, currency: string, country: string | null = null, fmpImpact = 'Medium') =>
  classifyEcoEvent({ name, currency, country, fmpImpact } as ClassifyInput);

describe('classifyEcoEvent — tri façon ForexFactory', () => {
  it('écarte les devises hors des 9 suivies par FF', () => {
    for (const ccy of ['BRL', 'TRY', 'MXN', 'RUB', 'PLN', 'INR', 'PHP', 'KRW']) {
      expect(c('Inflation Rate YoY (Sep)', ccy, null, 'High'), ccy).toBeNull();
    }
  });

  it('retire le bruit même classé High par FMP', () => {
    expect(c('CFTC S&P 500 speculative net positions', 'USD', 'US', 'High')).toBeNull();
    expect(c('MBA 30-Year Mortgage Rate (Oct/02)', 'USD', 'US')).toBeNull();
    expect(c('RICS House Price Balance (Sep)', 'GBP', 'UK')).toBeNull();
    expect(c('Ai Group Industry Index (Sep)', 'AUD', 'AU')).toBeNull();
    expect(c('Current Account (Aug)', 'JPY', 'JP', 'High')).toBeNull();
    expect(c('EIA Gasoline Stocks Change', 'USD', 'US')).toBeNull();
    expect(c('10-Year Note Auction', 'USD', 'US')).toBeNull();
  });

  it('garde le stock de brut EIA (suivi par les traders de CL) en moyen', () => {
    expect(c('EIA Crude Oil Stocks Change', 'USD', 'US')).toBe('medium');
  });

  it('les annonces majeures sont fortes, même classées Low par FMP', () => {
    expect(c('Non Farm Payrolls (Sep)', 'USD', 'US')).toBe('high');
    expect(c('CPI YoY (Sep)', 'USD', 'US')).toBe('high');
    expect(c('Core PCE Price Index MoM (Aug)', 'USD', 'US')).toBe('high');
    expect(c('FOMC Minutes', 'USD', 'US', 'Low')).toBe('high');
    expect(c('Fed Chair Powell Speech', 'USD', 'US', 'Low')).toBe('high');
    expect(c('Fed Interest Rate Decision', 'USD', 'US')).toBe('high');
    expect(c('ISM Manufacturing PMI (Sep)', 'USD', 'US')).toBe('high');
    expect(c('Employment Change (Sep)', 'CAD', 'CA')).toBe('high');
    expect(c('Unemployment Rate (Sep)', 'CAD', 'CA')).toBe('high');
    expect(c('BoJ Gov Ueda Speech', 'JPY', 'JP', 'Low')).toBe('high');
    expect(c('ECB Interest Rate Decision', 'EUR', 'EU')).toBe('high');
    expect(c('GDP Growth Rate QoQ Adv (Q3)', 'USD', 'US')).toBe('high');
    expect(c('GDP Growth Rate YoY (Q3)', 'CNY', 'CN')).toBe('high');
  });

  it('le reste jugé High/Medium par FMP devient moyen, le Low disparaît', () => {
    expect(c('ISM Services PMI (Sep)', 'USD', 'US', 'High')).toBe('medium');
    expect(c('Fed Waller Speech', 'USD', 'US', 'High')).toBe('medium');
    expect(c('Initial Jobless Claims (Oct/03)', 'USD', 'US')).toBe('medium');
    expect(c('Michigan Consumer Sentiment Prel (Oct)', 'USD', 'US')).toBe('medium');
    expect(c('Tokyo CPI YoY (Sep)', 'JPY', 'JP', 'High')).toBe('medium');
    expect(c('Michigan Consumer Sentiment Prel (Oct)', 'USD', 'US', 'Low')).toBeNull();
  });

  it('PIB : ni le déflateur ni le YoY (hors Chine) ne sont forts', () => {
    expect(c('GDP Price Index QoQ (Q2)', 'USD', 'US')).toBe('medium');
    expect(c('GDP Growth Rate YoY (Q2)', 'GBP', 'UK')).toBe('medium');
  });

  it('zone euro : agrégat fort, Allemagne/France moyens, autres pays écartés', () => {
    expect(c('Inflation Rate YoY Flash (Sep)', 'EUR', 'EU')).toBe('high');
    expect(c('Inflation Rate YoY Prel (Sep)', 'EUR', 'DE')).toBe('medium');
    expect(c('Industrial Production MoM (Aug)', 'EUR', 'DE')).toBe('medium');
    expect(c('Industrial Production MoM (Aug)', 'EUR', 'IT', 'High')).toBeNull();
    expect(c('HCOB Services PMI (Sep)', 'EUR', 'ES')).toBeNull();
  });
});
