import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import type { CreateTradeDto } from './dto/create-trade.dto';
import { AiLoggerService } from '../shared/ai-logger.service';
import { PrismaService } from '../../prisma/prisma.service';

const MODEL = 'claude-sonnet-4-6';

type BrokerType =
  | 'tradovate'
  | 'binance_futures'
  | 'binance_spot'
  | 'bybit'
  | 'mexc'
  | 'mt4'
  | 'mt5'
  | 'ibkr'
  | 'unknown';

// Limites différenciées : un broker connu est parsé localement (sans IA),
// l'inconnu passe par Claude par lots bornés pour maîtriser le coût.
const MAX_KNOWN_ROWS = 10_000;
const MAX_AI_ROWS = 2000;
const AI_BATCH = 250;

/** Accès requis pour le chemin IA d'import (broker inconnu) — Premium strict. */
interface AiImportAccess {
  plan: Plan;
  role: Role;
  trialEndsAt?: Date | null;
}

interface ClaudeTrade {
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  commission?: number;
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
    access?: AiImportAccess,
  ): Promise<Partial<CreateTradeDto>[]> {
    // 1. Obtenir du texte CSV (Excel converti localement, sinon UTF-8)
    const content = this.toCsvText(buffer, filename);
    if (!content) throw new BadRequestException('Fichier vide');
    if (content.split('\n').length < 2)
      throw new BadRequestException('Fichier sans données');

    // 2. Détecter le broker et pré-normaliser
    const { broker, csv } = this.preprocessCsv(content);
    const normalizedLines = csv.split('\n').filter((l) => l.trim());
    if (normalizedLines.length < 2)
      throw new BadRequestException(this.emptyMessage());

    let dtos: Partial<CreateTradeDto>[];

    if (broker !== 'unknown') {
      // 3. Broker connu → parsing local, gratuit, sans IA
      const dataCount = normalizedLines.length - 1;
      if (dataCount > MAX_KNOWN_ROWS) {
        throw new BadRequestException(
          `${dataCount} trades détectés. Maximum ${MAX_KNOWN_ROWS} par import. ` +
          `Découpe ton fichier par période.`,
        );
      }
      dtos = this.mapNormalizedCsvToDto(csv);
      this.logger.log(`CSV "${filename}" [${broker}] → ${dtos.length} trades (local, sans IA)`);
    } else {
      // 4. Broker inconnu → chemin IA (Anthropic) : réservé Premium + prod uniquement.
      //    Les brokers connus (ci-dessus) restent gratuits pour tous les plans.
      if (!this.aiImportAllowed(access)) {
        throw new BadRequestException(
          "Ce broker n'est pas encore reconnu automatiquement. " +
          "L'import intelligent par IA est réservé au plan Premium. " +
          "L'import direct fonctionne pour les brokers supportés (MEXC, Binance, Bybit, MT4/5, IBKR, Tradovate), " +
          "ou écris-nous sur Discord pour qu'on ajoute le tien.",
        );
      }
      dtos = await this.parseUnknownWithAi(normalizedLines, filename, userId);
    }

    if (!dtos.length) throw new BadRequestException(this.emptyMessage());
    return dtos;
  }

  /**
   * Le chemin IA d'import (broker inconnu → Anthropic) n'est autorisé que :
   * - en production (garde NODE_ENV : zéro dépense IA hors prod), ET
   * - pour un accès Premium strict (PREMIUM / ADMIN / BETA_TESTER / trial actif).
   * Aligné sur PremiumGuard — STARTER N'A PAS d'IA (CLAUDE.md).
   */
  private aiImportAllowed(access?: AiImportAccess): boolean {
    if (process.env['NODE_ENV'] !== 'production') return false;
    if (!access) return false;
    const trialActive =
      access.trialEndsAt != null && new Date() < new Date(access.trialEndsAt);
    return (
      access.plan === Plan.PREMIUM ||
      access.role === Role.ADMIN ||
      access.role === Role.BETA_TESTER ||
      trialActive
    );
  }

  /** Convertit le buffer en texte CSV : Excel → CSV local, sinon UTF-8. */
  private toCsvText(buffer: Buffer, filename: string): string {
    if (/\.(xlsx|xls)$/i.test(filename)) {
      try {
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        return XLSX.utils.sheet_to_csv(firstSheet).trim();
      } catch {
        throw new BadRequestException(
          "Impossible de lire ce fichier Excel. Réexporte-le en CSV depuis ton broker, " +
          "ou ouvre-le dans Excel/Google Sheets et enregistre-le en .csv.",
        );
      }
    }
    return buffer.toString('utf-8').trim();
  }

  // ── Chemin IA (broker inconnu) ──────────────────────────────────────────────

  private async parseUnknownWithAi(
    normalizedLines: string[],
    filename: string,
    userId?: string,
  ): Promise<Partial<CreateTradeDto>[]> {
    const dataLines = normalizedLines.slice(1);
    if (dataLines.length > MAX_AI_ROWS) {
      throw new BadRequestException(
        `${dataLines.length} lignes détectées. Maximum ${MAX_AI_ROWS} pour un import automatique. ` +
        `Découpe ton fichier par période, ou exporte uniquement tes trades fermés.`,
      );
    }

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

    const header = normalizedLines[0];
    const allTrades: ClaudeTrade[] = [];
    try {
      for (let i = 0; i < dataLines.length; i += AI_BATCH) {
        const chunk = [header, ...dataLines.slice(i, i + AI_BATCH)].join('\n');
        const parsed = await this.callClaudeForChunk(chunk, filename, styleNote, userId);
        allTrades.push(...parsed.trades);
        if (parsed.errors?.length) {
          this.logger.warn(`CSV "${filename}" — erreurs: ${parsed.errors.join(', ')}`);
        }
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Erreur parsing CSV', err);
      throw new BadRequestException(
        "Erreur lors de l'analyse du fichier. Assure-toi que c'est un export de trades fermés. " +
        "Si le souci persiste, envoie-nous le fichier sur le Discord, on l'ajoute.",
      );
    }

    return this.mapToDto(allTrades);
  }

  /** Un appel Claude pour un lot de lignes — extrait pour le batch des gros fichiers. */
  private async callClaudeForChunk(
    chunk: string,
    filename: string,
    styleNote: string,
    userId?: string,
  ): Promise<ClaudeResponse> {
    const prompt = this.buildPrompt(filename, chunk, styleNote);
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
        "On n'a pas pu lire ce fichier. Vérifie que c'est un export de " +
        "trades fermés (pas un historique d'ordres). Formats : CSV ou Excel.",
      );
    }

    if (!Array.isArray(parsed.trades)) {
      throw new BadRequestException(
        'Format de réponse inattendu. Réessaie avec un fichier plus petit.',
      );
    }

    if (userId) this.aiLogger.log(userId, 'csv_import', response.usage);
    return { ...parsed, trades: parsed.trades, errors: parsed.errors ?? [], skipped: parsed.skipped ?? 0 };
  }

  private emptyMessage(): string {
    return (
      'Aucun trade fermé détecté dans ce fichier. Sur ton broker, exporte ' +
      "l'historique des positions/trades fermés, pas les ordres en cours."
    );
  }

  // ── Prétraitement ───────────────────────────────────────────────────────────

  private preprocessCsv(raw: string): { broker: BrokerType; csv: string } {
    // BOM UTF-8 (exports Windows) + normalisation des fins de ligne CRLF/CR → \n
    const cleaned = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const lines = cleaned
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length < 2) return { broker: 'unknown', csv: cleaned };

    const broker = this.detectBroker(lines[0]);

    // MEXC découpe lui-même sur `;` → traiter avant la normalisation du séparateur.
    if (broker === 'mexc') return { broker, csv: this.parseMexc(lines) };

    // CSV européen : `;` séparateur + `,` décimale → tout ramener en virgule/point.
    const normalized = this.normalizeSeparator(cleaned);
    const nlines = normalized
      .trim()
      .split('\n')
      .filter((l) => l.trim());

    switch (broker) {
      case 'tradovate':
        return { broker, csv: this.parseTradovate(nlines) };
      case 'binance_futures':
        return { broker, csv: this.parseBinanceFutures(nlines) };
      case 'binance_spot':
        return { broker, csv: this.parseBinanceSpot(nlines) };
      case 'bybit':
        return { broker, csv: this.parseBybit(nlines) };
      case 'mt4':
      case 'mt5':
        return { broker, csv: this.parseMT5(nlines) };
      case 'ibkr':
        return { broker, csv: this.parseIBKR(nlines) };
      default:
        return { broker: 'unknown', csv: normalized };
    }
  }

  /** CSV européen : si la 1ʳᵉ ligne a plus de `;` que de `,`, basculer `,`(décimale)→`.` puis `;`→`,`. */
  private normalizeSeparator(text: string): string {
    const firstLine = text.split('\n')[0] ?? '';
    const semi = (firstLine.match(/;/g) ?? []).length;
    const comma = (firstLine.match(/,/g) ?? []).length;
    if (semi <= comma) return text;
    return text
      .split('\n')
      .map((line) => line.replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ','))
      .join('\n');
  }

  private detectBroker(header: string): BrokerType {
    const h = header.toLowerCase();

    // MEXC Futures — signature unique (en-tête `;`), ne collisionne avec aucun autre parser
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

  /**
   * MEXC Futures — format stable et propre → parser local (gratuit, sans IA).
   * En-tête `;` : UID;Futures;Open Time;Close Time;Margin Mode;Avg Entry Price;
   * Avg Close Price;Direction;Closing Qty (Cont.);Fee;Realized PNL;Status
   * Produit le CSV interne `symbol,side,entry,exit,qty,pnl,tradedAt,commission`.
   */
  private parseMexc(lines: string[]): string {
    const out: string[] = ['symbol,side,entry,exit,qty,pnl,tradedAt,commission'];
    // Robuste à un MEXC converti depuis Excel (séparateur `,` au lieu de `;`)
    const sep = (lines[0] ?? '').includes(';') ? ';' : ',';

    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].replace(/\r/g, '').split(sep);
      if (c.length < 12) continue;

      const [, futures, , closeTime, , entryRaw, closeRaw, dir, qtyRaw, feeRaw, pnlRaw, status] = c;
      if (!/closed/i.test(status ?? '')) continue; // trades fermés uniquement

      const num = (s: string) =>
        parseFloat(String(s ?? '').replace(/usdt/i, '').replace(',', '.').trim());
      const entry = num(entryRaw);
      const exit = num(closeRaw);
      const pnl = num(pnlRaw);
      const fee = num(feeRaw);
      const quantity = num(qtyRaw);
      const side = /short/i.test(dir ?? '') ? 'SHORT' : 'LONG';
      const asset = this.normalizeMexcSymbol(futures ?? '');
      // Close Time en UTC+02:00 → ISO avec offset explicite
      const tradedAt = `${(closeTime ?? '').trim().replace(' ', 'T')}+02:00`;

      if (!asset || !isFinite(entry) || !isFinite(pnl)) continue;
      out.push(
        [asset, side, entry, exit, quantity, pnl, tradedAt, isFinite(fee) ? Math.abs(fee) : 0].join(','),
      );
    }
    return out.join('\n');
  }

  /** BTCUSDT → BTC/USDT ; laisse intacts les formats exotiques (GOLD(XAUT)USDT, NAS100USDT…). */
  private normalizeMexcSymbol(raw: string): string {
    const s = raw.trim();
    const m = s.match(/^([A-Z0-9]{2,10})(USDT|USDC|USD)$/i);
    if (m && !/[()]/.test(s)) return `${m[1].toUpperCase()}/${m[2].toUpperCase()}`;
    return s; // exotique → brut (mieux qu'un découpage faux)
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
        commission: t.commission ?? undefined,
        emotion: 'NEUTRAL' as const,
        setup: 'BREAKOUT' as const,
        session: this.detectSession(t.tradedAt),
        timeframe: '1h',
        tradedAt: t.tradedAt,
        notes: t.notes ?? undefined,
      }));
  }

  /**
   * Mappe directement le CSV normalisé d'un broker connu en DTO, sans IA.
   * Lit les colonnes par nom (header) → tolère les variantes symbol/asset, qty/quantity,
   * et l'éventuelle colonne commission (MEXC). Estime l'entrée quand le broker
   * n'exporte pas le prix d'entrée (entry=0), comme le faisait le prompt Claude.
   */
  private mapNormalizedCsvToDto(csv: string): Partial<CreateTradeDto>[] {
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

    const out: Partial<CreateTradeDto>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const c = this.splitCsvLine(lines[i]);
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
        emotion: 'NEUTRAL' as const,
        setup: 'BREAKOUT' as const,
        session: this.detectSession(tradedAt),
        timeframe: '1h',
        tradedAt: tradedAt || new Date().toISOString(),
        notes: undefined,
      });
    }
    return out;
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
