import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { CreateTradeDto } from './dto/create-trade.dto';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Tu es un expert en trading qui analyse des fichiers CSV d'historique de trades.
Ta tâche : extraire chaque trade du CSV et le convertir en JSON structuré.

Règles :
- side : LONG si achat/buy/long, SHORT si vente/sell/short
- emotion : NEUTRAL par défaut si non fourni
- setup : BREAKOUT par défaut si non fourni
- session : détecte selon l'heure (LONDON 8h-17h UTC, NEW_YORK 13h-22h UTC, ASIAN 0h-8h UTC, OVERLAP 13h-17h UTC, PRE_MARKET sinon)
- timeframe : "1h" par défaut si non fourni
- pnl : nombre (positif = gain, négatif = perte)
- entry, exit : prix numériques
- quantity : nombre de lots/contrats/unités (défaut 1)
- tradedAt : format ISO 8601

Retourne UNIQUEMENT un JSON valide : { "trades": [ { "asset": "...", "side": "LONG|SHORT", ... } ] }
Aucun texte avant ou après le JSON.`;

@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);
  private readonly anthropic = new Anthropic({
    apiKey: process.env['ANTHROPIC_API_KEY'],
  });

  async parseCSV(
    buffer: Buffer,
    filename: string,
  ): Promise<Partial<CreateTradeDto>[]> {
    const content = buffer.toString('utf-8').trim();

    if (!content) throw new BadRequestException('Fichier CSV vide');

    const lines = content.split('\n');
    if (lines.length < 2) throw new BadRequestException('CSV sans données');

    const knownFormat = this.tryKnownFormats(content);
    if (knownFormat) return knownFormat;

    // Format inconnu → Claude parse
    const truncated = lines.slice(0, 51).join('\n'); // header + 50 lignes max
    const userMessage = `Fichier : ${filename}\n\nContenu CSV :\n${truncated}`;

    try {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text) as { trades: Partial<CreateTradeDto>[] };

      if (!Array.isArray(parsed.trades)) throw new Error('Format inattendu');

      this.logger.log(
        `CSV "${filename}" parsé par Claude: ${parsed.trades.length} trades`,
      );
      return parsed.trades;
    } catch (err) {
      this.logger.error('Erreur parsing CSV', err);
      throw new BadRequestException('Impossible de parser ce fichier CSV');
    }
  }

  private tryKnownFormats(content: string): Partial<CreateTradeDto>[] | null {
    const firstLine = content.split('\n')[0].toLowerCase();

    // Tradovate
    if (
      firstLine.includes('account') &&
      firstLine.includes('b/s') &&
      firstLine.includes('qty')
    ) {
      return this.parseTradovate(content);
    }

    // Binance spot history
    if (
      firstLine.includes('date') &&
      firstLine.includes('pair') &&
      firstLine.includes('type')
    ) {
      return this.parseBinance(content);
    }

    return null;
  }

  private parseTradovate(content: string): Partial<CreateTradeDto>[] {
    const lines = content.split('\n');
    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const idxSide = headers.findIndex((h) => h === 'b/s');
    const idxQty = headers.findIndex((h) => h === 'qty');
    const idxPrice = headers.findIndex((h) => h === 'fill price');
    const idxProduct = headers.findIndex((h) => h === 'product');
    const idxDate = headers.findIndex((h) => h === 'fill time');
    const idxPnl = headers.findIndex((h) => h === 'p/l');

    const trades: Partial<CreateTradeDto>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
      if (cols.length < 4 || !cols[idxProduct]) continue;

      const pnl = idxPnl >= 0 ? parseFloat(cols[idxPnl]) : undefined;
      trades.push({
        asset: cols[idxProduct]?.toUpperCase(),
        side: cols[idxSide]?.toUpperCase() === 'S' ? 'SHORT' : 'LONG',
        entry: parseFloat(cols[idxPrice]),
        quantity: parseInt(cols[idxQty]) || 1,
        pnl: isNaN(pnl ?? NaN) ? undefined : pnl,
        emotion: 'NEUTRAL',
        setup: 'BREAKOUT',
        session: 'NEW_YORK',
        timeframe: '1h',
        tradedAt:
          idxDate >= 0 && cols[idxDate]
            ? new Date(cols[idxDate]).toISOString()
            : new Date().toISOString(),
      });
    }
    return trades;
  }

  private parseBinance(content: string): Partial<CreateTradeDto>[] {
    const lines = content.split('\n');
    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const idxDate = headers.findIndex((h) => h.includes('date'));
    const idxPair = headers.findIndex((h) => h === 'pair');
    const idxType = headers.findIndex((h) => h === 'type');
    const idxPrice = headers.findIndex((h) => h === 'price');
    const idxQty = headers.findIndex(
      (h) => h.includes('amount') || h === 'quantity',
    );
    const idxPnl = headers.findIndex(
      (h) => h.includes('realized') || h.includes('pnl'),
    );

    const trades: Partial<CreateTradeDto>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
      if (cols.length < 3 || !cols[idxPair]) continue;

      const type = cols[idxType]?.toUpperCase() ?? '';
      if (!['BUY', 'SELL', 'LONG', 'SHORT'].some((t) => type.includes(t)))
        continue;

      const pnl = idxPnl >= 0 ? parseFloat(cols[idxPnl]) : undefined;
      const symbol = cols[idxPair]
        ?.replace('USDT', '/USDT')
        .replace('BUSD', '/BUSD');
      trades.push({
        asset: symbol,
        side: type.includes('BUY') || type.includes('LONG') ? 'LONG' : 'SHORT',
        entry: parseFloat(cols[idxPrice]),
        quantity: idxQty >= 0 ? parseFloat(cols[idxQty]) || 1 : 1,
        pnl: isNaN(pnl ?? NaN) ? undefined : pnl,
        emotion: 'NEUTRAL',
        setup: 'BREAKOUT',
        session: 'ASIAN',
        timeframe: '1h',
        tradedAt:
          idxDate >= 0 && cols[idxDate]
            ? new Date(cols[idxDate]).toISOString()
            : new Date().toISOString(),
      });
    }
    return trades;
  }
}
