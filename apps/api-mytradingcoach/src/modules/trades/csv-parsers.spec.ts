import { describe, expect, it } from 'vitest';
import {
  detectNumberFormat,
  mapNormalizedCsvToDto,
  normalizeSeparator,
  parseBinanceFutures,
  parseBinanceSpot,
  parseBybit,
  parseIBKR,
  parseMT5,
  parseTradovate,
  parseTradovatePnl,
  parseUsNumber,
  preprocessCsv,
} from './csv-parsers';

/**
 * Séparateur de milliers (bug prod du 2026-10-28) : `parseFloat("1,125.00")` vaut 1. Un trade
 * de +1 125 $ du compte « test NT8 » était importé à +1 $. Les exports Tradovate, et toute
 * conversion Excel (`sheet_to_csv` écrit les nombres formatés), mettent ces montants entre
 * guillemets avec des virgules de milliers.
 */
describe('parseTradovatePnl — P&L comptable de l’export Performance', () => {
  it.each([
    ['$1,125.00', 1125],
    ['$(1,125.00)', -1125],
    ['$12,345.67', 12345.67],
    ['$(1,234,567.89)', -1234567.89],
    ['$0.00', 0],
    ['$(0.00)', 0],
    ['$(25.00)', -25],
    ['$23.00', 23],
    ['-1,125.00', -1125],
    [' $ 1,125.00 ', 1125],
    ['', 0],
    ['$', 0],
    ['abc', 0],
    ['()', 0],
  ])('%j → %d', (raw, attendu) => {
    expect(parseTradovatePnl(raw)).toBe(attendu);
  });

  it('jamais -0 (un break-even reste un break-even)', () => {
    expect(Object.is(parseTradovatePnl('$(0.00)'), 0)).toBe(true);
  });
});

describe('parseUsNumber', () => {
  it.each([
    ['7,753.75', 7753.75],
    ['1 234.5', 1234.5],
    ['1\u00a0234.5', 1234.5],
    ['0.001BTC', 0.001],
    ['1,200BTC', 1200],
    ['1,234', 1234],
    ['12,345,678.9', 12345678.9],
    ['-3', -3],
  ])('%j → %d', (raw, attendu) => {
    expect(parseUsNumber(raw)).toBe(attendu);
  });

  it('NaN quand il n’y a aucun chiffre', () => {
    expect(parseUsNumber('')).toBeNaN();
    expect(parseUsNumber(undefined)).toBeNaN();
    expect(parseUsNumber('n/a')).toBeNaN();
  });
});

describe('parseTradovate — ligne réelle du compte « test NT8 » (27/10)', () => {
  const header =
    'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration';
  // Achat de 5 à 7753,75 puis vente à 7758,25 : LONG, +4,5 pts × 5 × 50 $ = +1 125 $.
  const ligne =
    'ESZ6,-2,0,0.25,700000000001,700000000002,5,7753.75,7758.25,"$1,125.00",2026-10-27T18:53:50Z,2026-10-27T19:01:29Z,7min39sec';

  it('P&L entier, sens LONG, clôture à la vente', () => {
    const [dto] = mapNormalizedCsvToDto(parseTradovate([header, ligne]));
    expect(dto).toMatchObject({ asset: 'ES', side: 'LONG', entry: 7753.75, exit: 7758.25, quantity: 5, pnl: 1125 });
    expect(dto.tradedAt).toBe('2026-10-27T19:01:29.000Z');
  });

  it('même résultat par preprocessCsv (chemin de l’import manuel)', () => {
    const { broker, csv } = preprocessCsv([header, ligne].join('\n'));
    expect(broker).toBe('tradovate');
    expect(mapNormalizedCsvToDto(csv)[0].pnl).toBe(1125);
  });
});

describe('séparateur de milliers — autres parseurs de brokers', () => {
  it('Binance Futures : prix et realized profit', () => {
    const csv = parseBinanceFutures([
      'Symbol,Side,Price,Quantity,Realized Profit,Time',
      'BTCUSDT,SELL,"67,234.50",0.5,"1,250.00",2026-10-27 10:00:00',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ exit: 67234.5, quantity: 0.5, pnl: 1250 });
  });

  it('Binance Spot : prix, quantité et P&L', () => {
    const csv = parseBinanceSpot([
      'Date,Market,Type,Price,Amount,Total,Realized PnL',
      '2026-10-27 10:00:00,BTCUSDT,SELL,"67,234.50","1,200",x,"1,250.00"',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ exit: 67234.5, quantity: 1200, pnl: 1250 });
  });

  it('Bybit : entrée, sortie, quantité et P&L', () => {
    const csv = parseBybit([
      'Time,Contracts,Side,Entry Price,Exit Price,Qty,Closed P&L',
      '2026-10-27 10:00:00,BTCUSDT,Buy,"66,000.00","67,250.00",1,"1,250.00"',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 66000, exit: 67250, pnl: 1250 });
  });

  it('MT4/5 : prix et profit (milliers à l’espace ou à la virgule)', () => {
    const csv = parseMT5([
      'Ticket,Open Time,Type,Lots,Symbol,Open Price,S/L,T/P,Close Time,Close Price,Commission,Swap,Profit',
      '1,2026.10.27 09:00:00,buy,1,US30,"42,000.0",0,0,2026.10.27 10:00:00,"42,100.0",-7,0,1 000.00',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 42000, exit: 42100, pnl: 993 });
  });

  it('IBKR : P&L réalisé, quantité et prix', () => {
    const csv = parseIBKR([
      'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Realized P/L,Buy/Sell',
      'Trades,Data,Order,Stocks,USD,AAPL,2026-10-27 10:00:00,"-1,000",230.5,"1,250.00",SELL',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ exit: 230.5, quantity: 1000, pnl: 1250 });
  });
});

/**
 * Virgule décimale européenne : une virgule n'est retirée que dans un regroupement de milliers
 * VALIDE. Sinon le comportement d'origine reste (`parseFloat` s'arrête à la virgule) : jamais
 * 10 ou 100 fois trop grand. `1.234,56` reste lu 1,234 : défaut d'origine, ticket format européen.
 */
describe('virgule décimale européenne — jamais lue 10 ou 100 fois trop grande', () => {
  it.each([
    ['12,50', 12.5, 12],
    ['0,5', 0.5, 0],
    ['12,5', 12.5, 12],
    ['(12,50)', -12.5, -12],
    ['1.234,56', 1234.56, 1.234],
    ['1 234,56', 1234.56, 1234],
    ['1,234,56', 1234.56, 1],
  ])('%j (vaut %d) → %d, jamais au-dessus en valeur absolue', (raw, vrai, attendu) => {
    const lu = parseUsNumber(raw);
    expect(lu).toBe(attendu);
    expect(Math.abs(lu)).toBeLessThanOrEqual(Math.abs(vrai));
  });

  // Une valeur européenne n'arrive entre guillemets que dans un CSV à virgules (fichier retouché
  // à la main) : c'est là que l'ancien retrait de toutes les virgules lisait 1 250 pour 12,50.
  it('Tradovate', () => {
    const csv = parseTradovate([
      'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
      'MNQZ6,-2,0,0.25,1,2,1,"30.928,50","30.934,00","$12,50",2026-10-27T10:00:00Z,2026-10-27T10:01:00Z,1min',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 30.928, exit: 30.934, pnl: 12 });
  });

  it('Binance Futures', () => {
    const csv = parseBinanceFutures([
      'Symbol,Side,Price,Quantity,Realized Profit,Time',
      'BTCUSDT,SELL,"1.234,56","0,5","12,50",2026-10-27 10:00:00',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ exit: 1.234, pnl: 12 });
  });

  it('Binance Spot', () => {
    const csv = parseBinanceSpot([
      'Date,Market,Type,Price,Amount,Total,Realized PnL',
      '2026-10-27 10:00:00,BTCUSDT,SELL,"1.234,56","2,5",x,"12,50"',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ exit: 1.234, quantity: 2, pnl: 12 });
  });

  it('Bybit', () => {
    const csv = parseBybit([
      'Time,Contracts,Side,Entry Price,Exit Price,Qty,Closed P&L',
      '2026-10-27 10:00:00,BTCUSDT,Buy,"1.200,50","1.234,56","2,5","12,50"',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 1.2, exit: 1.234, quantity: 2, pnl: 12 });
  });

  it('MT4/5', () => {
    const csv = parseMT5([
      'Ticket,Open Time,Type,Lots,Symbol,Open Price,S/L,T/P,Close Time,Close Price,Commission,Swap,Profit',
      '1,2026.10.27 09:00:00,buy,"0,5",EURUSD,"1,0850",0,0,2026.10.27 10:00:00,"1,0862","-0,70",0,"12,50"',
    ]);
    // Lots « 0,5 » → 0 : la quantité retombe à 1 par défaut, jamais gonflée à 5.
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 1, exit: 1, quantity: 1, pnl: 12 });
  });

  it('IBKR', () => {
    const csv = parseIBKR([
      'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Realized P/L,Buy/Sell',
      'Trades,Data,Order,Stocks,EUR,SAP,2026-10-27 10:00:00,"-2,5","1.234,56","12,50",SELL',
    ]);
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ exit: 1.234, quantity: 2, pnl: 12 });
  });

  it('CSV européen à « ; » : converti en amont, 12,50 lu 12,5', () => {
    const { broker, csv } = preprocessCsv([
      'Ticket;Open Time;Type;Lots;Symbol;Open Price;S/L;T/P;Close Time;Close Price;Commission;Swap;Profit',
      '1;2026.10.27 09:00:00;buy;0,5;EURUSD;1,0850;0;0;2026.10.27 10:00:00;1,0862;-0,70;0;12,50',
    ].join('\n'));
    expect(broker).toBe('mt5');
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 1.085, exit: 1.0862, quantity: 0.5, pnl: 11.8 });
  });
});

/**
 * Format des nombres décidé une fois par fichier (#781) : `1.234,56` était lu 1,234 dans un CSV
 * européen à `;` (1 000 fois trop petit). Fichier ambigu → refusé plutôt que deviné.
 */
describe('format des nombres décidé pour tout le fichier', () => {
  const MT5_HEADER =
    'Ticket;Open Time;Type;Lots;Symbol;Open Price;S/L;T/P;Close Time;Close Price;Commission;Swap;Profit';

  it('CSV européen à « ; » : 1.234,56 lu 1 234,56, pas 1,234', () => {
    const { broker, csv } = preprocessCsv([
      MT5_HEADER,
      '1;2026.10.27 09:00:00;buy;1,00;XAUUSD;2.650,10;0;0;2026.10.27 10:00:00;2.662,44;-7,00;0;1.234,56',
    ].join('\n'));
    expect(broker).toBe('mt5');
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({
      entry: 2650.1,
      exit: 2662.44,
      quantity: 1,
      pnl: 1227.56, // Profit 1 234,56 + commission -7,00
    });
  });

  it('espace de milliers et unité en suffixe (« 1 234,56 USD »)', () => {
    const { csv } = preprocessCsv([
      MT5_HEADER,
      '1;2026.10.27 09:00:00;buy;0,50;EURUSD;1,0850;0;0;2026.10.27 10:00:00;1,0862;0;0;1 234,56 USD',
    ].join('\n'));
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 1.085, exit: 1.0862, quantity: 0.5, pnl: 1234.56 });
  });

  it('151.234 (yen, 3 décimales) reste 151,234 quand le fichier écrit ses décimales au point', () => {
    const { csv } = preprocessCsv([
      MT5_HEADER,
      '1;2026.10.27 09:00:00;sell;0.10;USDJPY;151.234;0;0;2026.10.27 10:00:00;151.012;0;0;14.70',
    ].join('\n'));
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 151.234, exit: 151.012, quantity: 0.1, pnl: 14.7 });
  });

  it('151.234 vaut 151 234 dans un fichier européen (le point y est un séparateur de milliers)', () => {
    const { csv } = preprocessCsv([
      MT5_HEADER,
      '1;2026.10.27 09:00:00;buy;0,10;BTCJPY;151.234;0;0;2026.10.27 10:00:00;152.000;0;0;76,60',
    ].join('\n'));
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 151234, exit: 152000, quantity: 0.1, pnl: 76.6 });
  });

  it('CSV à « ; » au format US : 1,234.56 n’est plus lu 1,234', () => {
    const { csv } = preprocessCsv([
      MT5_HEADER,
      '1;2026.10.27 09:00:00;buy;1.00;XAUUSD;2,650.10;0;0;2026.10.27 10:00:00;2,662.44;0;0;1,234.56',
    ].join('\n'));
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 2650.1, exit: 2662.44, pnl: 1234.56 });
  });

  it('CSV à virgules aux valeurs européennes entre guillemets : converties', () => {
    const { broker, csv } = preprocessCsv([
      'Time,Contracts,Side,Entry Price,Exit Price,Qty,Closed P&L',
      '2026-10-27 10:00:00,BTCUSDT,Buy,"1.200,50","1.234,56","2,5","1.085,00"',
    ].join('\n'));
    expect(broker).toBe('bybit');
    expect(mapNormalizedCsvToDto(csv)[0]).toMatchObject({ entry: 1200.5, exit: 1234.56, quantity: 2.5, pnl: 1085 });
  });

  it('CSV à virgules au format US : intact, « 1,085 » reste 1 085', () => {
    const raw = [
      'Time,Contracts,Side,Entry Price,Exit Price,Qty,Closed P&L',
      '2026-10-27 10:00:00,BTCUSDT,Buy,"1,200.50","1,234.56",2.5,"1,085"',
    ].join('\n');
    expect(normalizeSeparator(raw)).toEqual({ csv: raw, format: 'us' });
    expect(mapNormalizedCsvToDto(preprocessCsv(raw).csv)[0]).toMatchObject({ entry: 1200.5, pnl: 1085 });
  });

  it('formats mélangés dans un même fichier : refusé, rien n’est lu', () => {
    const res = preprocessCsv([
      MT5_HEADER,
      '1;2026.10.27 09:00:00;buy;1,00;XAUUSD;2.650,10;0;0;2026.10.27 10:00:00;2.662,44;0;0;1.234,56',
      '2;2026.10.28 09:00:00;buy;1.00;XAUUSD;2,650.10;0;0;2026.10.28 10:00:00;2,662.44;0;0;1,234.56',
    ].join('\n'));
    expect(res).toMatchObject({ broker: 'unknown', numbersAmbiguous: true });
  });

  it.each([
    ['dates, heures et symboles ne votent pas', ['2026.10.27;10:00;EURUSD.r;US30.cash;12,50'], 'eu'],
    ['virgule seule à 3 chiffres dans un fichier à « ; » : décimale', ['1,085;x'], 'eu'],
    ['point seul à 3 chiffres : décimale', ['151.234;x'], 'us'],
    ['les deux à 3 chiffres, sans autre indice : ambigu', ['1,085;151.234'], 'ambigu'],
    ['0,125 n’est pas un regroupement de milliers', ['0,125;151.234'], 'eu'],
  ])('%s', (_libelle, lignes, attendu) => {
    expect(detectNumberFormat(lignes, ';')).toBe(attendu);
  });
});

/**
 * Mode strict (#782) : remplace `parseReportAmount` des rapports Tradovate (soldes de clôture,
 * payouts). Même lecture des milliers que l'import ; tout ce qui n'est pas un nombre entier vaut NaN.
 */
describe('parseUsNumber — mode strict des rapports', () => {
  it.each([
    ['"50,000.00"', 50_000],
    ['(125.50)', -125.5],
    ['$1,234.5', 1_234.5],
    ['$(1,250.00)', -1_250],
    ['-42.10', -42.1],
    ['1,234,567.89', 1_234_567.89],
  ])('%j → %d', (brut, attendu) => {
    expect(parseUsNumber(brut, { strict: true })).toBe(attendu);
  });

  it.each([
    ['n/a'],
    [''],
    ['12,50'], // l'ancien parseReportAmount y lisait 1 250
    ['0.001BTC'],
    ['1.2.3'],
  ])('%j → NaN', (brut) => {
    expect(parseUsNumber(brut, { strict: true })).toBeNaN();
  });

  it('le mode tolérant (import) garde son comportement', () => {
    expect(parseUsNumber('0.001BTC')).toBe(0.001);
    expect(parseUsNumber('12,50')).toBe(12);
    expect(parseUsNumber('"$1,125.00"')).toBe(1125);
  });
});
