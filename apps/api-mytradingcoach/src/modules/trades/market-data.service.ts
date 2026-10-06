import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AnthropicClientService } from '../infra/anthropic-client.service';
import { CACHE_TTL } from '../../common/constants/cache-ttl.const';
import { INSTRUMENTS } from './instruments.const';
import { NO_EM_DASH_RULE } from '../ai/prompts/style.prompt';
import { AI_MODELS } from '../infra/ai-pricing.const';
import { fetchWithTimeout } from '../../common/utils/fetch-timeout';
import { singleFlight } from '../../common/utils/single-flight';
import { isBreakingNews } from './market-news.breaking';
import { MACRO_NEWS_SYMBOL, NEWS_FEEDS, newsSymbolsFor, parseFmpNewsDate } from './market-news.sources';

export interface MarketContextItem { value: number | null; changePct: number | null; source: 'fmp' | 'yahoo' | 'binance'; }
export interface TreasuryRates {
  t2y: number | null;  t2yChg: number | null;
  t5y: number | null;  t5yChg: number | null;
  t10y: number | null; t10yChg: number | null;
  t30y: number | null; t30yChg: number | null;
}
export interface MarketContextDto {
  nq: MarketContextItem; spx: MarketContextItem; dxy: MarketContextItem;
  treasury: TreasuryRates; updatedAt: string;
}
const TREASURY_EMPTY: TreasuryRates = {
  t2y: null, t2yChg: null, t5y: null, t5yChg: null,
  t10y: null, t10yChg: null, t30y: null, t30yChg: null,
};
export interface NewsItem {
  id: string; title: string; symbol: string; publishedDate: string;
  sentiment?: 'bull' | 'bear' | 'neutral'; url?: string; text?: string; image?: string; site?: string;
  textTranslated?: boolean;
  /** Candidate au bandeau BREAKING (macro, hors crypto, récente) : cf. market-news.breaking.ts. */
  breaking?: boolean;
}

/** Titres par appel de traduction : la réponse JSON tient largement dans max_tokens. */
const NEWS_TITLE_BATCH = 10;
/** Titres traduits par passage du cron (20 min) : plusieurs flux, donc plus de news qu'avant. */
const NEWS_TRANSLATE_PER_RUN = 60;

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly anthropicClient: AnthropicClientService,
  ) {}

  // Garde-fou environnement : pas de traduction hors prod (économie Dev)
  private get translationEnabled(): boolean {
    return process.env['NODE_ENV'] === 'production'
      && process.env['NEWS_TRANSLATION'] !== 'off';
  }

  async getMarketContext(): Promise<MarketContextDto> {
    const cacheKey = 'market:context';
    // Clé froide : un seul appel aux fournisseurs, les autres attendent le cache (SCA-B3-04).
    return singleFlight(
      this.redisService,
      cacheKey,
      async () => {
        const cached = await this.redisService.client.get(cacheKey);
        return cached ? (JSON.parse(cached) as MarketContextDto) : null;
      },
      () => this.fetchMarketContext(cacheKey),
    );
  }

  private async fetchMarketContext(cacheKey: string): Promise<MarketContextDto> {
    const empty = { price: null, changePct: null };
    const [nq, spx, dxy, treasury] = await Promise.allSettled([
      this.fetchYahooQuote('NQ=F'),
      this.fetchYahooQuote('^GSPC'), // indice S&P 500 réel (~5 487), pas l'ETF SPY (~755)
      this.fetchYahooQuote('DX-Y.NYB'),
      this.fetchTreasuryRates(),
    ]);

    const nqV  = nq.status  === 'fulfilled' ? nq.value  : empty;
    const spxV = spx.status === 'fulfilled' ? spx.value : empty;
    const dxyV = dxy.status === 'fulfilled' ? dxy.value : empty;

    const result: MarketContextDto = {
      nq:       { value: nqV.price,  changePct: nqV.changePct,  source: 'yahoo' },
      spx:      { value: spxV.price, changePct: spxV.changePct, source: 'yahoo' },
      dxy:      { value: dxyV.price, changePct: dxyV.changePct, source: 'yahoo' },
      treasury: treasury.status === 'fulfilled' ? treasury.value : TREASURY_EMPTY,
      updatedAt: new Date().toISOString(),
    };
    try { await this.redisService.client.setex(cacheKey, CACHE_TTL.MARKET_CTX, JSON.stringify(result)); } catch { /* ignore */ }
    return result;
  }

  async getNews(symbols: string): Promise<NewsItem[]> {
    const cacheKey = `market:news:${symbols || 'default'}`;
    try {
      const cached = await this.redisService.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as NewsItem[];
    } catch { /* ignore */ }

    // Actifs du journal (MNQ, EUR/USD…) → symboles de news FMP (QQQ, EURUSD…), macro incluse.
    // Avant : comparaison exacte, aucun futures ne matchait et le News live se vidait dès le
    // premier trade du jour. Rien de trouvé → toutes les news plutôt qu'un bloc vide.
    const list = (symbols || '').split(',').map(s => s.trim()).filter(Boolean);
    const query = (where: object) => this.prisma.marketNews.findMany({
      where, orderBy: { publishedDate: 'desc' }, take: 20,
    });
    let rows = list.length ? await query({ symbol: { in: newsSymbolsFor(list) } }) : [];
    if (!rows.length) rows = await query({});
    const items: NewsItem[] = rows.map(r => ({
      id: r.id,
      title: r.titleFr ?? r.title,
      symbol: r.symbol,
      publishedDate: r.publishedDate.toISOString(),
      sentiment: (r.sentiment as NewsItem['sentiment']) ?? 'neutral',
      url: r.url,
      text: r.textFr ?? r.text ?? undefined,
      image: r.image ?? undefined,
      site: r.site ?? undefined,
      textTranslated: r.textTranslated,
      // Sur le titre ANGLAIS d'origine : une fois traduit, « ECB » devient « BCE ».
      breaking: isBreakingNews({ title: r.title, symbol: r.symbol, publishedDate: r.publishedDate }),
    }));
    try { await this.redisService.client.setex(cacheKey, CACHE_TTL.NEWS, JSON.stringify(items)); } catch { /* ignore */ }
    return items;
  }

  async refreshNewsBatch(): Promise<number> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey) return 0;
    // Plusieurs flux, chacun sa limite (cf. market-news.sources.ts) : un flux en échec
    // n'empêche pas les autres.
    const raw: NewsItem[] = [];
    for (const feed of NEWS_FEEDS) {
      const sep = feed.path.includes('?') ? '&' : '?';
      try {
        const res = await fetchWithTimeout(`https://financialmodelingprep.com/stable/news/${feed.path}${sep}apikey=${apiKey}`);
        if (!res.ok) { this.logger.warn(`News fetch ${feed.path.split('?')[0]} : HTTP ${res.status}`); continue; }
        const data = await res.json() as NewsItem[];
        if (Array.isArray(data)) raw.push(...data.map(it => ({ ...it, symbol: it.symbol || feed.symbol || MACRO_NEWS_SYMBOL })));
      } catch (err) {
        this.logger.warn(`News fetch failed: ${(err as Error).message}`);
      }
    }

    // 1) Upsert sans traduction (dédup par url)
    for (const it of raw) {
      if (!it.url) continue;
      await this.prisma.marketNews.upsert({
        where: { url: it.url },
        update: { sentiment: it.sentiment ?? null }, // refresh sentiment éventuel
        create: {
          url: it.url, symbol: it.symbol, title: it.title, text: it.text ?? null,
          sentiment: it.sentiment ?? null, image: it.image ?? null, site: it.site ?? null,
          publishedDate: parseFmpNewsDate(it.publishedDate), // heure de New York, cf. sources
        },
      });
    }

    // 2) Traduire uniquement les TITRES non-traduits (output minime). Le texte de
    //    l'article est traduit paresseusement à l'ouverture (ensureNewsTextFr).
    if (!this.translationEnabled) return 0;
    const pending = await this.prisma.marketNews.findMany({
      where: { translated: false },
      orderBy: { publishedDate: 'desc' },
      take: NEWS_TRANSLATE_PER_RUN,
    });
    if (!pending.length) return 0;

    // Par lots : 30 titres en un seul appel à 800 tokens dépassaient le plafond, le JSON
    // arrivait tronqué (« Unterminated string ») et AUCUN titre n'était traduit, lot
    // retenté toutes les 20 min. Un lot illisible n'empêche pas les autres d'aboutir.
    let translated = 0;
    for (let i = 0; i < pending.length; i += NEWS_TITLE_BATCH) {
      const batch = pending.slice(i, i + NEWS_TITLE_BATCH);
      const fr = await this.translateTitles(batch.map(p => p.title));
      if (!fr) continue;
      await Promise.all(batch.map((p, j) =>
        this.prisma.marketNews.update({
          where: { id: p.id },
          data: { titleFr: fr[j] || p.title, translated: true },
        }),
      ));
      translated += batch.length;
    }
    return translated;
  }

  /** Titres traduits dans le même ordre, ou `null` si la réponse est inexploitable. */
  private async translateTitles(titles: string[]): Promise<string[] | null> {
    try {
      const msg = await this.anthropicClient.create({
        model: AI_MODELS.fast,
        max_tokens: 1200,
        messages: [{ role: 'user', content:
          `Traduis en français ces titres de news financières. ${NO_EM_DASH_RULE} Réponds UNIQUEMENT avec un tableau JSON d'objets {title} dans le même ordre, sans texte autour.\n\n${JSON.stringify(titles)}` }],
      }, { feature: 'news_translation', userId: null });
      const txt = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      const s = txt.indexOf('['), e = txt.lastIndexOf(']');
      if (s === -1 || e === -1) return null;
      const tr = JSON.parse(txt.slice(s, e + 1)) as { title?: string }[];
      // Réponse décalée (titre manquant ou en trop) : on ne risque pas d'attribuer
      // la traduction d'un titre à un autre.
      if (!Array.isArray(tr) || tr.length !== titles.length) return null;
      return tr.map(t => (typeof t?.title === 'string' ? t.title : ''));
    } catch (err) {
      this.logger.warn(`News title translation failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Traduction paresseuse du corps d'un article, à la première ouverture, puis persistée.
   * Idempotent + best-effort : aucun appel modèle si déjà traduit (ou pas de texte),
   * et en cas d'échec on retourne le texte original sans crasher.
   */
  async ensureNewsTextFr(id: string): Promise<string | null> {
    const news = await this.prisma.marketNews.findUnique({ where: { id } });
    if (!news) return null;
    // Déjà traduit, ou pas de texte à traduire → zéro appel modèle.
    if (news.textTranslated || news.text == null) return news.textFr ?? news.text;
    // Interrupteur fin (NEWS_TRANSLATION / hors prod) → renvoyer le texte tel quel.
    if (!this.translationEnabled) return news.textFr ?? news.text;

    // Une seule traduction IA par news, même ouverte par 30 personnes en même temps (SCA-B3-05) :
    // les autres attendent la ligne traduite ; si la traduction échoue ou traîne, ils renvoient le
    // texte d'origine au lieu de relancer chacun un appel payant.
    const original = news.textFr ?? news.text;
    return singleFlight(
      this.redisService,
      `news-fr:${id}`,
      async () => {
        const row = await this.prisma.marketNews.findUnique({ where: { id }, select: { textFr: true, textTranslated: true } });
        return row?.textTranslated ? row.textFr : null;
      },
      () => this.translateNewsText(id, news.text as string, original),
      { lockMs: 30_000, pollMs: 500, onTimeout: async () => original },
    );
  }

  /** Appel IA de traduction, puis écriture en base. En cas d'échec : texte d'origine. */
  private async translateNewsText(id: string, text: string, original: string | null): Promise<string | null> {
    try {
      const msg = await this.anthropicClient.create({
        model: AI_MODELS.fast,
        max_tokens: 700,
        messages: [{ role: 'user', content:
          `Traduis en français ce texte de news financière. ${NO_EM_DASH_RULE} Réponds UNIQUEMENT avec la traduction, sans préambule ni guillemets.\n\n${text}` }],
      }, { feature: 'news_translation', userId: null });
      const fr = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
      if (!fr) return original;
      await this.prisma.marketNews.update({
        where: { id },
        data: { textFr: fr, textTranslated: true },
      });
      return fr;
    } catch (err) {
      this.logger.warn(`News text translation failed: ${(err as Error).message}`);
      return original;
    }
  }

  async getLivePrice(symbol: string): Promise<{ price: number | null; cached: boolean }> {
    const sym = symbol.trim().toUpperCase();
    const cacheKey = `price:${sym}`;
    let fromCache = true;
    const price = await singleFlight(
      this.redisService,
      cacheKey,
      async () => {
        const cached = await this.redisService.client.get(cacheKey);
        return cached ? parseFloat(cached) : null;
      },
      async () => {
        fromCache = false;
        return this.fetchLivePrice(sym, cacheKey);
      },
    );
    return { price, cached: fromCache };
  }

  /** Appel au fournisseur du symbole ; met le prix en cache s'il est connu. */
  private async fetchLivePrice(sym: string, cacheKey: string): Promise<number | null> {
    let price: number | null = null;
    if (INSTRUMENTS.some(i => i.symbol.toUpperCase() === sym && i.category === 'FUTURES_US')) {
      price = await this.fetchYahooPrice(`${sym}=F`);
    } else if (sym.includes('USDT')) {
      price = await this.fetchBinancePrice(sym.replace('/', ''));
    } else {
      price = await this.fetchFmpPrice(this.mapSymbolToFmp(sym));
    }

    if (price !== null) {
      try { await this.redisService.client.setex(cacheKey, CACHE_TTL.PRICE, String(price)); } catch { /* ignore */ }
    }
    return price;
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; label: string; category: string }>> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey || !query.trim()) return [];
    try {
      const url = `https://financialmodelingprep.com/stable/search?query=${encodeURIComponent(query)}&limit=12&apikey=${apiKey}`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) return [];
      const data = await res.json() as Array<{ symbol: string; name: string; exchangeShortName: string }>;
      return data.filter(r => r.symbol && r.name)
        .map(r => ({ symbol: r.symbol, label: `${r.name} (${r.symbol})`, category: this.getCategory(r.exchangeShortName ?? '') }))
        .slice(0, 10);
    } catch (err) {
      this.logger.warn(`FMP search failed: ${(err as Error).message}`);
      return [];
    }
  }

  async fetchYahooPrice(yahooSymbol: string): Promise<number | null> {
    return (await this.fetchYahooQuote(yahooSymbol)).price;
  }

  /** Prix + variation % vs clôture précédente. Aucune requête supplémentaire :
   *  le `meta` Yahoo contient déjà `previousClose` / `chartPreviousClose`. */
  async fetchYahooQuote(yahooSymbol: string): Promise<{ price: number | null; changePct: number | null }> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return { price: null, changePct: null };
      const data = await res.json() as {
        chart: { result?: Array<{ meta: { regularMarketPrice?: number; previousClose?: number; chartPreviousClose?: number } }> };
      };
      const meta = data?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice ?? null;
      const prev = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
      const changePct =
        price != null && prev != null && prev !== 0
          ? Number((((price - prev) / prev) * 100).toFixed(2))
          : null;
      return { price, changePct };
    } catch { return { price: null, changePct: null }; }
  }

  async fetchBinancePrice(symbol: string): Promise<number | null> {
    try {
      const res = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      const data = await res.json() as { price: string };
      return data?.price ? parseFloat(data.price) : null;
    } catch { return null; }
  }

  async fetchFmpPrice(symbol: string): Promise<number | null> {
    return (await this.fetchFmpQuote(symbol)).price;
  }

  /** Prix + variation % via FMP `/stable/quote` (champ `changePercentage`,
   *  legacy `changesPercentage`). Pas de requête supplémentaire. */
  async fetchFmpQuote(symbol: string): Promise<{ price: number | null; changePct: number | null }> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey) return { price: null, changePct: null };
    try {
      const res = await fetchWithTimeout(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
      if (!res.ok) return { price: null, changePct: null };
      const data = await res.json() as Array<{ price?: number; changePercentage?: number; changesPercentage?: number }>;
      const row = data?.[0];
      const pct = row?.changePercentage ?? row?.changesPercentage ?? null;
      return {
        price: row?.price ?? null,
        changePct: pct != null ? Number(pct.toFixed(2)) : null,
      };
    } catch { return { price: null, changePct: null }; }
  }

  mapSymbolToFmp(symbol: string): string {
    const map: Record<string, string> = {
      'EUR/USD': 'EURUSD', 'GBP/USD': 'GBPUSD', 'USD/JPY': 'USDJPY',
      'AUD/USD': 'AUDUSD', 'USD/CHF': 'USDCHF', 'NZD/USD': 'NZDUSD',
      'USD/CAD': 'USDCAD', 'EUR/GBP': 'EURGBP', 'EUR/JPY': 'EURJPY',
      'GBP/JPY': 'GBPJPY',
      'MNQ': 'QQQ', 'NQ': 'QQQ', 'MES': 'SPY', 'ES': 'SPY',
      'MYM': 'DIA', 'YM': 'DIA', 'GC': 'GLD', 'MGC': 'GLD',
      'CL': 'USO', 'MCL': 'USO', 'M2K': 'IWM', 'RTY': 'IWM',
      'BTC/USDT': 'BTCUSD', 'ETH/USDT': 'ETHUSD',
      'BTC/USD': 'BTCUSD', 'ETH/USD': 'ETHUSD',
      'SOL/USDT': 'SOLUSD', 'XRP/USDT': 'XRPUSD',
      'BNB/USDT': 'BNBUSD', 'ADA/USDT': 'ADAUSD',
    };
    return map[symbol] ?? symbol;
  }

  private async fetchTreasuryRates(): Promise<TreasuryRates> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey) return TREASURY_EMPTY;
    try {
      const res = await fetchWithTimeout(`https://financialmodelingprep.com/stable/treasury-rates?apikey=${apiKey}`);
      if (!res.ok) return TREASURY_EMPTY;
      const data = await res.json() as Array<Record<string, number>>;
      const latest = data?.[0];
      if (!latest) return TREASURY_EMPTY;
      // data[1] = veille (l'endpoint renvoie l'historique) → variation en points de %.
      const prev = data?.[1] ?? null;
      const pick = (row: Record<string, number> | null, keys: string[]): number | null => {
        if (!row) return null;
        for (const k of keys) if (row[k] != null) return row[k];
        return null;
      };
      const K2 = ['year2', 'twoYear', '2Year'];
      const K5 = ['year5', 'fiveYear', '5Year'];
      const K10 = ['year10', 'tenYear', '10Year'];
      const K30 = ['year30', 'thirtyYear', '30Year'];
      const chg = (cur: number | null, old: number | null): number | null =>
        cur != null && old != null ? Number((cur - old).toFixed(2)) : null;
      const t2y = pick(latest, K2), t5y = pick(latest, K5), t10y = pick(latest, K10), t30y = pick(latest, K30);
      return {
        t2y,  t2yChg:  chg(t2y,  pick(prev, K2)),
        t5y,  t5yChg:  chg(t5y,  pick(prev, K5)),
        t10y, t10yChg: chg(t10y, pick(prev, K10)),
        t30y, t30yChg: chg(t30y, pick(prev, K30)),
      };
    } catch (err) {
      this.logger.warn(`Treasury rates failed: ${(err as Error).message}`);
      return TREASURY_EMPTY;
    }
  }

  private getCategory(exchange: string): string {
    const ex = exchange.toUpperCase();
    if (['CME', 'CBOT', 'NYMEX', 'COMEX'].includes(ex)) return 'FUTURES';
    if (['CRYPTO', 'COINBASE', 'BINANCE'].includes(ex)) return 'CRYPTO';
    if (ex === 'FOREX' || ex === 'FX') return 'FOREX';
    if (['NYSE', 'NASDAQ', 'AMEX'].includes(ex)) return 'ACTIONS';
    return 'AUTRES';
  }
}
