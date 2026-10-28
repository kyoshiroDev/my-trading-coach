import { describe, expect, it } from 'vitest';
import {
  mapNormalizedCsvToDto,
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
