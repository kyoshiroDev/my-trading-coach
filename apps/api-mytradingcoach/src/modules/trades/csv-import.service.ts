import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { CreateTradeDto } from './dto/create-trade.dto';
import { AiLoggerService } from '../shared/ai-logger.service';
import { PrismaService } from '../../prisma/prisma.service';

const MODEL = 'claude-sonnet-4-6';

type BrokerType =
  | 'tradovate'
  | 'binance_futures'
  | 'binance_spot'
  | 'bybit'
  | 'mt4'
  | 'mt5'
  | 'ibkr'
  | 'unknown';

interface ClaudeTrade {
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  tradedAt: string;
  notes?: string | null;
}

interface ClaudeResponse {
  broker: string;
  trades: ClaudeTrade[];
  skipped: number;
  errors: string[];
}

@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);
  private readonly anthropic = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
  });

  constructor(
    private readonly aiLogger: AiLoggerService,
    private readonly prisma: PrismaService,
  ) {}

  async parseCSV(
    buffer: Buffer,
    filename: string,
    userId?: string,
  ): Promise<Partial<CreateTradeDto>[]> {
    const content = buffer.toString('utf-8').trim();
    if (!content) throw new BadRequestException('Fichier CSV vide');

    const lines = content.split('\n');
    if (lines.length < 2) throw new BadRequestException('CSV sans données');

    const normalizedCsv = this.preprocessCsv(content);
    const normalizedLines = normalizedCsv.split('\n');

    if (normalizedLines.length > 501) {
      throw new BadRequestException(
        `Fichier trop volumineux : ${normalizedLines.length - 1} trades détectés. ` +
        `Importe maximum 500 trades à la fois en découpant ton fichier par période.`,
      );
    }

    const truncated = normalizedLines.slice(0, 501).join('\n');

    let styleNote = '';
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { tradingStyle: true, tradesPerDayMax: true },
      });
      if (user?.tradingStyle === 'SCALPING' || (user?.tradesPerDayMax != null && user.tradesPerDayMax > 20)) {
        styleNote = `\nNote : Ce trader est scalper avec une fréquence élevée de trades — c'est normal pour son style.`;
      }
    }

    const prompt = this.buildPrompt(filename, truncated, styleNote);

    try {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: [
          {
            type: 'text',
            text: 'Tu es un parseur de fichiers CSV de trading. Retourne UNIQUEMENT du JSON valide. Aucun texte avant ou après.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: prompt }],
      });

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';
      const clean = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      let parsed: ClaudeResponse;
      try {
        parsed = JSON.parse(clean) as ClaudeResponse;
      } catch {
        this.logger.error(
          `JSON invalide reçu de Claude pour "${filename}":`,
          clean.slice(0, 200),
        );
        throw new BadRequestException(
          "Le fichier CSV n'a pas pu être interprété. " +
          "Vérifie que c'est bien un export de trades fermés (pas un historique d'ordres).",
        );
      }

      if (!Array.isArray(parsed.trades)) {
        throw new BadRequestException(
          'Format de réponse inattendu. Réessaie avec un fichier plus petit.',
        );
      }

      if (parsed.errors?.length) {
        this.logger.warn(
          `CSV "${filename}" — erreurs: ${parsed.errors.join(', ')}`,
        );
      }
      this.logger.log(
        `CSV "${filename}" [${parsed.broker}] → ${parsed.trades.length} trades, ${parsed.skipped ?? 0} ignorés`,
      );
      if (userId) this.aiLogger.log(userId, 'csv_import', response.usage);

      return this.mapToDto(parsed.trades);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Erreur parsing CSV', err);
      throw new BadRequestException(
        "Erreur lors de l'analyse du fichier. " +
        "Assure-toi que le fichier est bien un export CSV de trades fermés depuis ton broker.",
      );
    }
  }

  // ── Prétraitement ───────────────────────────────────────────────────────────

  private preprocessCsv(raw: string): string {
    // Supprimer BOM UTF-8 que certains exports Windows ajoutent
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const lines = cleaned
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length < 2) return cleaned;

    const broker = this.detectBroker(lines[0]);

    switch (broker) {
      case 'tradovate':
        return this.parseTradovate(lines);
      case 'binance_futures':
        return this.parseBinanceFutures(lines);
      case 'binance_spot':
        return this.parseBinanceSpot(lines);
      case 'bybit':
        return this.parseBybit(lines);
      case 'mt4':
      case 'mt5':
        return this.parseMT5(lines);
      case 'ibkr':
        return this.parseIBKR(lines);
      default:
        return raw;
    }
  }

  private detectBroker(header: string): BrokerType {
    const h = header.toLowerCase();

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

  private parseTradovate(lines: string[]): string {
    const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = this.splitCsvLine(line);
      if (cols.length < 12) continue;

      const rawSymbol = cols[0].trim();
      const qty = parseInt(cols[6].trim(), 10) || 1;
      const buyPrice = parseFloat(cols[7].trim());
      const sellPrice = parseFloat(cols[8].trim());
      const rawPnl = cols[9].trim();
      const boughtAt = cols[10].trim();
      const soldAt = cols[11].trim();

      if (isNaN(buyPrice) || isNaN(sellPrice)) continue;

      // Normaliser symbole : MNQM6 → MNQ, ESZ25 → ES, 6EH6 → 6E
      const symbol = rawSymbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');

      const pnl = this.parseTradovatePnl(rawPnl);
      const boughtDate = new Date(boughtAt);
      const soldDate = new Date(soldAt);
      const side = boughtDate <= soldDate ? 'LONG' : 'SHORT';
      const entry = side === 'LONG' ? buyPrice : sellPrice;
      const exit = side === 'LONG' ? sellPrice : buyPrice;
      const tradedAt = (side === 'LONG' ? soldDate : boughtDate).toISOString();

      result.push(`${symbol},${side},${entry},${exit},${qty},${pnl},${tradedAt}`);
    }
    return result.join('\n');
  }

  private parseTradovatePnl(raw: string): number {
    const cleaned = raw.replace(/\$/g, '').trim();
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      return -parseFloat(cleaned.slice(1, -1));
    }
    return parseFloat(cleaned) || 0;
  }

  private parseBinanceFutures(lines: string[]): string {
    const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = this.splitCsvLine(line);
      if (cols.length < 5) continue;

      const rawSymbol = cols[0].trim();
      const side = cols[1].trim().toUpperCase();
      const price = parseFloat(cols[2].trim());
      const qty = parseFloat(cols[3].trim());
      const pnl = parseFloat(cols[4].replace(/,/g, '').trim()) || 0;
      const timeStr = cols[5]?.trim() || '';

      if (pnl === 0 || isNaN(price) || isNaN(qty)) continue;

      const symbol = this.normalizeBinanceSymbol(rawSymbol);
      const tradeSide = side === 'SELL' ? 'LONG' : 'SHORT';
      const tradedAt = timeStr ? new Date(timeStr).toISOString() : new Date().toISOString();

      result.push(`${symbol},${tradeSide},0,${price},${qty},${pnl},${tradedAt}`);
    }
    return result.join('\n');
  }

  private parseBinanceSpot(lines: string[]): string {
    const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const idxDate = headers.findIndex((h) => h.includes('date'));
    const idxMarket = headers.findIndex((h) => h === 'market' || h === 'pair');
    const idxType = headers.findIndex((h) => h === 'type');
    const idxPrice = headers.findIndex((h) => h === 'price');
    const idxQty = headers.findIndex((h) => h === 'amount' || h === 'quantity');
    const idxPnl = headers.findIndex((h) => h.includes('realized') || h.includes('pnl'));

    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCsvLine(lines[i]);
      if (cols.length < 4 || !cols[idxMarket]) continue;

      const type = (cols[idxType] ?? '').toUpperCase();
      if (!['BUY', 'SELL'].some((t) => type.includes(t))) continue;

      const pnl = idxPnl >= 0 ? parseFloat(cols[idxPnl]?.replace(/,/g, '') ?? '') : 0;
      if (isNaN(pnl) || pnl === 0) continue;

      const symbol = this.normalizeBinanceSymbol(cols[idxMarket]);
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

  private parseMT5(lines: string[]): string {
    const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = this.splitCsvLine(line);
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
      const normalizedSymbol = this.normalizeMT5Symbol(symbol);

      result.push(`${normalizedSymbol},${side},${openPrice},${closePrice},${lots},${pnl},${tradedAt}`);
    }
    return result.join('\n');
  }

  private parseBybit(lines: string[]): string {
    const result: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt'];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = this.splitCsvLine(line);
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
      const symbol = this.normalizeBinanceSymbol(rawSymbol);
      const tradedAt = timeStr ? new Date(timeStr).toISOString() : new Date().toISOString();

      result.push(`${symbol},${side},${entry},${exit},${qty},${pnl},${tradedAt}`);
    }
    return result.join('\n');
  }

  private parseIBKR(lines: string[]): string {
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

      const cols = this.splitCsvLine(line);
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

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private normalizeBinanceSymbol(raw: string): string {
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

  private normalizeMT5Symbol(raw: string): string {
    if (!raw) return raw;
    // EURUSD → EUR/USD (paires forex exactement 6 chars majuscules)
    if (/^[A-Z]{6}$/.test(raw)) return `${raw.slice(0, 3)}/${raw.slice(3)}`;
    // XAUUSD → XAU/USD
    if (/^[A-Z]{3}USD$/.test(raw)) return `${raw.slice(0, 3)}/USD`;
    // Futures avec code mois : MNQM6 → MNQ
    return raw.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
  }

  // Gère les champs entre guillemets avec virgules internes
  private splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
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

  private buildPrompt(filename: string, csv: string, styleNote = ''): string {
    return `Fichier : ${filename}${styleNote}

Ce CSV a été partiellement normalisé. Certains champs "entry" peuvent être 0
si le broker n'exporte pas le prix d'entrée exact.

Si entry=0 et exit+pnl+qty sont connus :
→ LONG : entry = exit - (pnl / qty)
→ SHORT : entry = exit + (pnl / qty)
→ Ajoute "entry estimé" dans notes

Retourne UNIQUEMENT ce JSON (aucun markdown) :
{
  "broker": string,
  "trades": [{
    "asset": string,
    "side": "LONG" | "SHORT",
    "entry": number,
    "exit": number,
    "quantity": number,
    "pnl": number,
    "tradedAt": "ISO 8601",
    "notes": string | null
  }],
  "skipped": number,
  "errors": [string]
}

Règles :
- Symboles normalisés : MNQ (pas MNQM6), BTC/USDT (pas BTCUSDT), EUR/USD (pas EURUSD)
- PnL en nombre décimal : -11.50 (pas $(11.50))
- Ignorer dépôts, retraits, frais sans trade associé
- tradedAt = date de clôture ISO 8601
- session selon heure UTC : LONDON 8-17h, NEW_YORK 13-22h, ASIAN 0-8h, OVERLAP 13-17h, PRE_MARKET sinon

CSV :
${csv}`;
  }

  // ── Mapping DTO ─────────────────────────────────────────────────────────────

  private mapToDto(trades: ClaudeTrade[]): Partial<CreateTradeDto>[] {
    return trades
      .filter((t) => t.asset && t.side && t.entry >= 0)
      .map((t) => ({
        asset: t.asset,
        side: t.side as 'LONG' | 'SHORT',
        entry: t.entry,
        exit: t.exit > 0 ? t.exit : undefined,
        quantity: t.quantity || 1,
        pnl: t.pnl,
        commission: (t as any).commission ?? undefined,
        emotion: 'NEUTRAL' as const,
        setup: 'BREAKOUT' as const,
        session: this.detectSession(t.tradedAt),
        timeframe: '1h',
        tradedAt: t.tradedAt,
        notes: t.notes ?? undefined,
      }));
  }

  private detectSession(iso: string): 'LONDON' | 'NEW_YORK' | 'ASIAN' {
    try {
      const hour = new Date(iso).getUTCHours();
      if (hour >= 0 && hour < 8)   return 'ASIAN';
      if (hour >= 8 && hour < 13)  return 'LONDON';
      if (hour >= 13 && hour < 22) return 'NEW_YORK';
      return 'LONDON';
    } catch {
      return 'NEW_YORK';
    }
  }
}
