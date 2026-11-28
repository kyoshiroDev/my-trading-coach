/**
 * Devises dont les annonces économiques concernent un actif (#670, #667). Source unique, partagée par le
 * briefing, le bouclier annonces, la stat du débrief et le contrat de session. Fonction PURE.
 */
const MAJORS = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

/** Racines de contrats et d'indices → devises dont les annonces les concernent. */
const ROOTS: Record<string, string[]> = {
  // Indices US, énergie, métaux, taux US, crypto CME : cotés en dollars
  NQ: ['USD'], MNQ: ['USD'], ES: ['USD'], MES: ['USD'], YM: ['USD'], MYM: ['USD'],
  RTY: ['USD'], M2K: ['USD'], CL: ['USD'], MCL: ['USD'], GC: ['USD'], MGC: ['USD'],
  SI: ['USD'], SIL: ['USD'], ZB: ['USD'], ZN: ['USD'], ZF: ['USD'], MBT: ['USD'], MET: ['USD'],
  US30: ['USD'], US100: ['USD'], NAS100: ['USD'], US500: ['USD'], SPX500: ['USD'], SPX: ['USD'],
  BTC: ['USD'], ETH: ['USD'], SOL: ['USD'], XRP: ['USD'],
  // Futures de devises CME : la devise contre le dollar
  '6E': ['EUR', 'USD'], M6E: ['EUR', 'USD'], '6B': ['GBP', 'USD'], '6J': ['JPY', 'USD'],
  '6A': ['AUD', 'USD'], '6C': ['CAD', 'USD'], '6S': ['CHF', 'USD'], '6N': ['NZD', 'USD'],
  // Indices hors US
  FDAX: ['EUR'], DAX: ['EUR'], GER40: ['EUR'], DE40: ['EUR'], FESX: ['EUR'], EU50: ['EUR'], CAC40: ['EUR'], FRA40: ['EUR'],
  UK100: ['GBP'], FTSE: ['GBP'], JP225: ['JPY'], NKD: ['JPY', 'USD'], NIKKEI: ['JPY'],
};

/**
 * Racine d'un actif, en majuscules, échéance retirée : « NQZ6 », « MNQZ2026 », « MNQ 12-26 » → « NQ », « MNQ ».
 * Une paire ou un symbole sans échéance reste tel quel (« EURUSD »).
 */
export function assetRoot(asset: string): string {
  return asset.trim().toUpperCase().split(/[\s:]/)[0].replace(/([FGHJKMNQUVXZ]\d{1,4}|\d{2}-\d{2})$/, '');
}

/**
 * Devises dont les annonces concernent un actif : paire de devises (EUR/USD, XAUUSD), racine de
 * contrat avec ou sans échéance (NQZ6, MNQ 12-26), indice, crypto. Inconnu → aucune.
 */
export function assetCurrencies(asset: string): string[] {
  const raw = asset.trim().toUpperCase();
  const compact = raw.replace(/[\s/_.:-]/g, '').replace(/USDT$|USDC$/, 'USD');

  // Racine connue, échéance retirée (« NQZ6 », « MNQZ2026 », « MNQ 12-26 »)
  const root = assetRoot(asset);
  if (ROOTS[root]) return ROOTS[root];
  if (ROOTS[compact]) return ROOTS[compact];

  // Paire de 6 lettres (EURUSD, XAUUSD) : les majeures qu'elle contient
  if (/^[A-Z]{6}$/.test(compact)) {
    const found = [compact.slice(0, 3), compact.slice(3)].filter((c) => MAJORS.includes(c));
    if (found.length) return found;
  }
  return [];
}
