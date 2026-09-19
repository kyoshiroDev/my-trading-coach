/**
 * Parseurs CSV des brokers connus — fonctions PURES (étape 4 de l'audit, 2026-09-13).
 * Extraites de CsvImportService, dont elles ne dépendaient d'aucun service injecté : lecture
 * des lignes, détection du broker, normalisation au CSV pivot, puis DTO d'import. Le service
 * garde l'orchestration (plan, IA pour les formats inconnus, frais Tradovate, persistance).
 */
import type { CreateTradeDto } from './dto/create-trade.dto';
import { detectTradingSession, normalizeFuturesSymbol, resolvePairDirection } from './tradovate-pair.util';

export type BrokerType =
  | 'tradovate'
  | 'binance_futures'
  | 'binance_spot'
  | 'bybit'
  | 'mexc'
  | 'mt4'
  | 'mt5'
  | 'ibkr'
  | 'unknown';

/** DTO d'import enrichi de métadonnées internes (fill ids Tradovate) : non persistées. */
export type ImportDto = Partial<CreateTradeDto> & {
  _buyFillId?: string;
  _sellFillId?: string;
};

export function preprocessCsv(raw: string): { broker: BrokerType; csv: string } {
  // BOM UTF-8 (exports Windows) + normalisation des fins de ligne CRLF/CR → \n
  const cleaned = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = cleaned
    .trim()
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2) return { broker: 'unknown', csv: cleaned };

  const broker = detectBroker(lines[0]);

  // MEXC découpe lui-même sur `;` → traiter avant la normalisation du séparateur.
  if (broker === 'mexc') return { broker, csv: parseMexc(lines) };

  // CSV européen : `;` séparateur + `,` décimale → tout ramener en virgule/point.
  const normalized = normalizeSeparator(cleaned);
  const nlines = normalized
    .trim()
    .split('\n')
    .filter((l) => l.trim());

  switch (broker) {
    case 'tradovate':
      return { broker, csv: parseTradovate(nlines) };
    case 'binance_futures':
      return { broker, csv: parseBinanceFutures(nlines) };
    case 'binance_spot':
      return { broker, csv: parseBinanceSpot(nlines) };
    case 'bybit':
      return { broker, csv: parseBybit(nlines) };
    case 'mt4':
    case 'mt5':
      return { broker, csv: parseMT5(nlines) };
    case 'ibkr':
      return { broker, csv: parseIBKR(nlines) };
    default:
      return { broker: 'unknown', csv: normalized };
  }
}

/** CSV européen : si la 1ʳᵉ ligne a plus de `;` que de `,`, basculer `,`(décimale)→`.` puis `;`→`,`. */
export function normalizeSeparator(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  const semi = (firstLine.match(/;/g) ?? []).length;
  const comma = (firstLine.match(/,/g) ?? []).length;
  if (semi <= comma) return text;
  return text
    .split('\n')
    .map((line) => line.replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ','))
    .join('\n');
}

export function detectBroker(header: string): BrokerType {
  const h = header.toLowerCase();

  // MEXC Futures : signature unique (en-tête `;`), ne collisionne avec aucun autre parser
  if (
    h.includes('futures') &&
    h.includes('avg entry price') &&
    h.includes('realized pnl') &&
    h.includes('direction')
  )
    return 'mexc';

  if (h.includes('buyfillid') && h.includes('sellfillid')) return 'tradovate';

  if (
    h.includes('contracts') &&
    h.includes('entry price') &&
    h.includes('exit price')
  )
    return 'bybit';

  if (h.includes('symbol') && h.includes('side') && h.includes('realized profit'))
    return 'binance_futures';

  if (
    h.includes('date') &&
    h.includes('market') &&
    h.includes('type') &&
    h.includes('price') &&
    h.includes('amount') &&
    h.includes('total')
  )
    return 'binance_spot';

  if (
    h.includes('ticket') &&
    h.includes('lots') &&
    h.includes('profit') &&
    h.includes('swap') &&
    h.includes('commission')
  )
    return 'mt5';

  if (
    h.includes('ticket') &&
    h.includes('open time') &&
    h.includes('close time') &&
    h.includes('profit')
  )
    return 'mt4';

  if (
    h.includes('trades') &&
    h.includes('header') &&
    h.includes('asset category')
  )
    return 'ibkr';

  // Bybit via colonnes nommées
  if (
    h.includes('avg entry price') &&
    h.includes('avg exit price') &&
    h.includes('closed p&l')
  )
    return 'bybit';

  return 'unknown';
}

// ── Parsers → CSV normalisé ─────────────────────────────────────────────────

export function parseTradovate(lines: string[]): string {
  // Fill ids lus PAR NOM (l'export Performance peut varier de colonnes) → jointure frais.
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const iBuyFill = header.indexOf('buyfillid');
  const iSellFill = header.indexOf('sellfillid');

  const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt,buyFillId,sellFillId'];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 12) continue;

    const rawSymbol = cols[0].trim();
    const qty = parseInt(cols[6].trim(), 10) || 1;
    const buyPrice = parseFloat(cols[7].trim());
    const sellPrice = parseFloat(cols[8].trim());
    const rawPnl = cols[9].trim();
    const boughtAt = cols[10].trim();
    const soldAt = cols[11].trim();
    const buyFillId = iBuyFill >= 0 ? (cols[iBuyFill] ?? '').trim() : '';
    const sellFillId = iSellFill >= 0 ? (cols[iSellFill] ?? '').trim() : '';

    if (isNaN(buyPrice) || isNaN(sellPrice)) continue;

    // Normaliser symbole : MNQM6 → MNQ, ESZ25 → ES, 6EH6 → 6E
    const symbol = normalizeFuturesSymbol(rawSymbol);

    const pnl = parseTradovatePnl(rawPnl);
    // Sens / entrée / sortie / date : règle partagée avec la synchro API (tradovate-pair.util).
    const { side, entry, exit, tradedAt } = resolvePairDirection({
      buyPrice,
      sellPrice,
      boughtAt: new Date(boughtAt),
      soldAt: new Date(soldAt),
    });

    result.push(
      `${symbol},${side},${entry},${exit},${qty},${pnl},${tradedAt.toISOString()},${buyFillId},${sellFillId}`,
    );
  }
  return result.join('\n');
}

export function parseTradovatePnl(raw: string): number {
  const cleaned = raw.replace(/\$/g, '').trim();
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return -parseFloat(cleaned.slice(1, -1));
  }
  return parseFloat(cleaned) || 0;
}

export function parseBinanceFutures(lines: string[]): string {
  const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 5) continue;

    const rawSymbol = cols[0].trim();
    const side = cols[1].trim().toUpperCase();
    const price = parseFloat(cols[2].trim());
    const qty = parseFloat(cols[3].trim());
    const pnl = parseFloat(cols[4].replace(/,/g, '').trim()) || 0;
    const timeStr = cols[5]?.trim() || '';

    if (pnl === 0 || isNaN(price) || isNaN(qty)) continue;

    const symbol = normalizeBinanceSymbol(rawSymbol);
    const tradeSide = side === 'SELL' ? 'LONG' : 'SHORT';
    const tradedAt = timeStr ? new Date(timeStr).toISOString() : new Date().toISOString();

    result.push(`${symbol},${tradeSide},0,${price},${qty},${pnl},${tradedAt}`);
  }
  return result.join('\n');
}

export function parseBinanceSpot(lines: string[]): string {
  const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const idxDate = headers.findIndex((h) => h.includes('date'));
  const idxMarket = headers.findIndex((h) => h === 'market' || h === 'pair');
  const idxType = headers.findIndex((h) => h === 'type');
  const idxPrice = headers.findIndex((h) => h === 'price');
  const idxQty = headers.findIndex((h) => h === 'amount' || h === 'quantity');
  const idxPnl = headers.findIndex((h) => h.includes('realized') || h.includes('pnl'));

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 4 || !cols[idxMarket]) continue;

    const type = (cols[idxType] ?? '').toUpperCase();
    if (!['BUY', 'SELL'].some((t) => type.includes(t))) continue;

    const pnl = idxPnl >= 0 ? parseFloat(cols[idxPnl]?.replace(/,/g, '') ?? '') : 0;
    if (isNaN(pnl) || pnl === 0) continue;

    const symbol = normalizeBinanceSymbol(cols[idxMarket]);
    const side = type.includes('BUY') ? 'LONG' : 'SHORT';
    const price = parseFloat(cols[idxPrice] ?? '');
    const qty = idxQty >= 0 ? parseFloat(cols[idxQty] ?? '') || 1 : 1;
    const tradedAt =
      idxDate >= 0 && cols[idxDate]
        ? new Date(cols[idxDate]).toISOString()
        : new Date().toISOString();

    result.push(`${symbol},${side},0,${price},${qty},${pnl},${tradedAt}`);
  }
  return result.join('\n');
}

export function parseMT5(lines: string[]): string {
  const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 13) continue;

    const type = cols[2]?.trim().toLowerCase();
    if (!type || !['buy', 'sell'].includes(type)) continue;

    const lots = parseFloat(cols[3]?.trim() ?? '');
    const symbol = cols[4]?.trim() ?? '';
    const openPrice = parseFloat(cols[5]?.trim() ?? '');
    const closeTime = cols[8]?.trim() ?? '';
    const closePrice = parseFloat(cols[9]?.trim() ?? '');
    const commission = parseFloat(cols[10]?.trim() ?? '') || 0;
    const swap = parseFloat(cols[11]?.trim() ?? '') || 0;
    const profit = parseFloat(cols[12]?.trim() ?? '') || 0;

    if (isNaN(openPrice) || isNaN(closePrice) || isNaN(lots)) continue;

    const side = type === 'buy' ? 'LONG' : 'SHORT';
    const pnl = profit + commission + swap;
    // MT4/5 date format: "2026.01.15 10:30:00" → "2026-01-15 10:30:00"
    const normalizedDate = closeTime.replace(/\./g, '-').replace(/(\d{4}-\d{2}-\d{2})/, '$1');
    const tradedAt = closeTime ? new Date(normalizedDate).toISOString() : new Date().toISOString();
    const normalizedSymbol = normalizeMT5Symbol(symbol);

    result.push(`${normalizedSymbol},${side},${openPrice},${closePrice},${lots},${pnl},${tradedAt}`);
  }
  return result.join('\n');
}

export function parseBybit(lines: string[]): string {
  const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 7) continue;

    const timeStr = cols[0]?.trim() ?? '';
    const rawSymbol = cols[1]?.trim() ?? '';
    const rawSide = cols[2]?.trim() ?? '';
    const entry = parseFloat(cols[3]?.trim() ?? '');
    const exit = parseFloat(cols[4]?.trim() ?? '');
    const qty = parseFloat(cols[5]?.trim() ?? '');
    const pnl = parseFloat(cols[6]?.replace(/,/g, '').trim() ?? '') || 0;

    if (isNaN(entry) || isNaN(exit)) continue;

    const side = rawSide === 'Buy' ? 'LONG' : 'SHORT';
    const symbol = normalizeBinanceSymbol(rawSymbol);
    const tradedAt = timeStr ? new Date(timeStr).toISOString() : new Date().toISOString();

    result.push(`${symbol},${side},${entry},${exit},${qty},${pnl},${tradedAt}`);
  }
  return result.join('\n');
}

export function parseIBKR(lines: string[]): string {
  const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

  let headerLine = '';
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Trades,Header,')) {
      headerLine = lines[i];
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) return result.join('\n');

  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const symbolCol = col('symbol');
  const buySellCol = col('buy/sell');
  const quantityCol = col('quantity');
  const priceCol = col('t. price');
  const pnlCol = col('realized p/l');
  const dateCol = col('date/time');

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('Trades,Data,')) break;

    const cols = splitCsvLine(line);
    const pnl = parseFloat(cols[pnlCol]?.trim() ?? '') || 0;
    if (pnl === 0) continue;

    const symbol = (cols[symbolCol]?.trim() ?? '').replace('.', '/');
    const qty = Math.abs(parseFloat(cols[quantityCol]?.trim() ?? '') || 0);
    const price = parseFloat(cols[priceCol]?.trim() ?? '') || 0;
    const dateStr = cols[dateCol]?.trim() ?? '';
    const tradedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    const side = cols[buySellCol]?.trim() === 'BUY' ? 'LONG' : 'SHORT';

    result.push(`${symbol},${side},0,${price},${qty},${pnl},${tradedAt}`);
  }
  return result.join('\n');
}

/**
 * MEXC Futures : parser local (gratuit, sans IA).
 * En-tête réel (export CSV et XLSX, identiques) :
 *   Futures;Open Time;Close Time;Margin Mode;Avg Entry Price;Avg Close Price;
 *   Direction;Closing Qty (Cont.);Trading Fee;Realized PNL;Status;UID
 * - Lecture par NOM de colonne → robuste si MEXC réordonne (ex. UID passé en dernier).
 * - Découpage quote-aware via splitCsvLine(sep) → gère le XLSX où sheet_to_csv entoure
 *   les nombres de guillemets (`"1,644.31"`).
 * - Nombres format US : virgule = séparateur de milliers → on la retire (garde le point).
 * Produit le CSV interne `symbol,side,entry,exit,qty,pnl,tradedAt,commission`.
 */
export function parseMexc(lines: string[]): string {
  const out: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt,commission'];
  // Robuste à un MEXC converti depuis Excel (séparateur `,` au lieu de `;`)
  const sep = (lines[0] ?? '').includes(';') ? ';' : ',';

  const header = splitCsvLine((lines[0] ?? '').replace(/\r/g, ''), sep).map((h) =>
    h.trim().toLowerCase(),
  );
  const at = (...needles: string[]) =>
    header.findIndex((h) => needles.some((n) => h.includes(n)));

  const iSym = at('futures');
  const iClose = at('close time');
  const iEntry = at('avg entry');
  const iExit = at('avg close');
  const iDir = at('direction');
  const iQty = at('closing qty', 'qty');
  const iFee = at('fee'); // "Trading Fee" ou "Fee"
  const iPnl = at('realized pnl', 'pnl');
  const iStatus = at('status');

  // Format US : retire le suffixe USDT et les virgules de milliers, garde le point décimal.
  const num = (s: string) =>
    parseFloat(String(s ?? '').replace(/usdt/i, '').replace(/,/g, '').trim());

  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i].replace(/\r/g, ''), sep);
    if (c.length < header.length) continue;

    if (!/closed/i.test(c[iStatus] ?? '')) continue; // trades fermés uniquement

    const entry = num(c[iEntry]);
    const exit = num(c[iExit]);
    const pnl = num(c[iPnl]);
    const fee = iFee >= 0 ? num(c[iFee]) : NaN;
    const quantity = num(c[iQty]);
    const side = /short/i.test(c[iDir] ?? '') ? 'SHORT' : 'LONG';
    const asset = normalizeMexcSymbol(c[iSym] ?? '');
    // Close Time en UTC+02:00 → ISO avec offset explicite
    const tradedAt = `${(c[iClose] ?? '').trim().replace(' ', 'T')}+02:00`;

    if (!asset || !isFinite(entry) || !isFinite(pnl)) continue;
    out.push(
      [asset, side, entry, exit, quantity, pnl, tradedAt, isFinite(fee) ? Math.abs(fee) : 0].join(','),
    );
  }
  return out.join('\n');
}

/** BTCUSDT → BTC/USDT ; laisse intacts les formats exotiques (GOLD(XAUT)USDT, NAS100USDT…). */
export function normalizeMexcSymbol(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^([A-Z0-9]{2,10})(USDT|USDC|USD)$/i);
  if (m && !/[()]/.test(s)) return `${m[1].toUpperCase()}/${m[2].toUpperCase()}`;
  return s; // exotique → brut (mieux qu'un découpage faux)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function normalizeBinanceSymbol(raw: string): string {
  if (!raw) return raw;
  const stablecoins = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB'];
  for (const stable of stablecoins) {
    if (raw.endsWith(stable) && raw.length > stable.length) {
      return `${raw.slice(0, -stable.length)}/${stable}`;
    }
  }
  // Fallback USD
  if (raw.endsWith('USD') && raw.length > 3) {
    return `${raw.slice(0, -3)}/USD`;
  }
  return raw;
}

export function normalizeMT5Symbol(raw: string): string {
  if (!raw) return raw;
  // EURUSD → EUR/USD (paires forex exactement 6 chars majuscules)
  if (/^[A-Z]{6}$/.test(raw)) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
  // XAUUSD → XAU/USD
  if (/^[A-Z]{3}USD$/.test(raw)) return `${raw.slice(0, 3)}/USD`;
  // Futures avec code mois : MNQM6 → MNQ
  return raw.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
}

// Gère les champs entre guillemets contenant le séparateur (CSV ou `;`).
export function splitCsvLine(line: string, sep = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.replace(/^"|"$/g, '').trim());
  return result;
}

// ── Prompt Claude ───────────────────────────────────────────────────────────

/**
 * Mappe directement le CSV normalisé d'un broker connu en DTO, sans IA.
 * Lit les colonnes par nom (header) → tolère les variantes symbol/asset, qty/quantity,
 * et l'éventuelle colonne commission (MEXC). Estime l'entrée quand le broker
 * n'exporte pas le prix d'entrée (entry=0), comme le faisait le prompt Claude.
 */
export function mapNormalizedCsvToDto(csv: string): ImportDto[] {
  const lines = csv.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const at = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSym = at('symbol', 'asset');
  const iSide = at('side');
  const iEntry = at('entry');
  const iExit = at('exit');
  const iQty = at('qty', 'quantity');
  const iPnl = at('pnl');
  const iComm = at('commission');
  const iDate = at('tradedat');
  // Fill ids Tradovate (métadonnée interne pour la fusion des frais) : absents des autres brokers.
  const iBuyFill = at('buyfillid');
  const iSellFill = at('sellfillid');

  const out: ImportDto[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const asset = (c[iSym] ?? '').trim();
    if (!asset) continue;

    const side = (c[iSide] ?? '').trim().toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    let entry = parseFloat(c[iEntry] ?? '');
    const exit = iExit >= 0 ? parseFloat(c[iExit] ?? '') : NaN;
    const quantity = iQty >= 0 ? parseFloat(c[iQty] ?? '') : NaN;
    const pnl = iPnl >= 0 ? parseFloat((c[iPnl] ?? '').replace(/,/g, '')) : 0;
    const commission = iComm >= 0 ? parseFloat(c[iComm] ?? '') : NaN;
    const tradedAt = (c[iDate] ?? '').trim();

    // Estimer l'entrée si le broker ne l'exporte pas (parsers émettant entry=0)
    if (
      (!isFinite(entry) || entry === 0) &&
      isFinite(exit) && isFinite(pnl) && isFinite(quantity) && quantity !== 0
    ) {
      entry = side === 'LONG' ? exit - pnl / quantity : exit + pnl / quantity;
    }
    if (!isFinite(entry) || entry < 0) continue;

    out.push({
      asset,
      side,
      entry,
      exit: isFinite(exit) && exit > 0 ? exit : undefined,
      quantity: isFinite(quantity) && quantity > 0 ? quantity : 1,
      pnl: isFinite(pnl) ? pnl : 0,
      commission: isFinite(commission) ? Math.abs(commission) : undefined,
      emotion: null, // override optionnel : réassigné par le lot (ou null) dans parseCSV
      // setupId affecté en aval (parseCSV) : setup par défaut du user, ou fourni par l'import (PROMPT-138).
      session: detectSession(tradedAt),
      timeframe: '1h',
      tradedAt: tradedAt || new Date().toISOString(),
      notes: undefined,
      // Métadonnées internes (jointure frais Tradovate), retirées avant persistance.
      _buyFillId: iBuyFill >= 0 ? (c[iBuyFill] ?? '').trim() || undefined : undefined,
      _sellFillId: iSellFill >= 0 ? (c[iSellFill] ?? '').trim() || undefined : undefined,
    });
  }
  return out;
}

export function detectSession(iso: string): 'LONDON' | 'NEW_YORK' | 'ASIAN' {
  return detectTradingSession(iso);
}
