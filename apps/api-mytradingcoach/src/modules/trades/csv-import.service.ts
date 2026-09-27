import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Plan, Role, EmotionState } from '@prisma/client';
import * as XLSX from 'xlsx';
import type { CreateTradeDto } from './dto/create-trade.dto';
import { AnthropicClientService } from '../infra/anthropic-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SetupsService } from '../setups/setups.service';
import {
  detectSession,
  mapNormalizedCsvToDto,
  preprocessCsv,
  splitCsvLine,
  type ImportDto,
} from './csv-parsers';
import {
  assignFeesOncePerFill,
} from './tradovate-pair.util';
import { AI_MODELS } from '../infra/ai-pricing.const';

const MODEL = AI_MODELS.analysis;


// Limites différenciées : un broker connu est parsé localement (sans IA),
// l'inconnu passe par Claude par lots bornés pour maîtriser le coût.
const MAX_KNOWN_ROWS = 10_000;

// Au-delà, un total global réparti au prorata donnerait des frais lissés faux :
// on désactive la saisie d'un total des frais (front) et on l'ignore (back).
const FEES_INPUT_MAX_TRADES = 5000;
const MAX_AI_ROWS = 2000;
const AI_BATCH = 250;

/** Accès requis pour le chemin IA d'import (broker inconnu) : Premium strict. */
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


/** Rapport de rapprochement des frais (fusion Tradovate Performance + Cash history). */
export interface FeesReport {
  /** Σ commissions attribuées aux trades (après dédup des fills partagés). */
  assigned: number;
  /** Σ |Delta| des lignes Commission du Cash history (checksum attendu). */
  expected: number;
  /** true si |assigned − expected| < 0,01 (frais rapprochés au centime). */
  reconciled: boolean;
  /**
   * false quand un fichier de frais a été fourni mais n'a PAS pu être exploité
   * (Cash history illisible / en-tête non reconnu) : l'import aboutit sans frais,
   * le P&L affiché est donc brut. Absent (undefined) ⇒ fusion réussie, pour ne pas
   * casser les consommateurs existants du rapport.
   */
  merged?: boolean;
  /** Nombre de trades de l'import. */
  count: number;
}

@Injectable()
export class CsvImportService {
  private readonly logger = new Logger(CsvImportService.name);

  constructor(
    private readonly anthropicClient: AnthropicClientService,
    private readonly prisma: PrismaService,
    private readonly setups: SetupsService,
  ) {}

  async parseCSV(
    buffer: Buffer,
    filename: string,
    userId?: string,
    access?: AiImportAccess,
    totalFees?: number,
    defaults?: { accountId?: string; emotion?: string; setupId?: string },
    // Fichier de frais optionnel (Tradovate Cash history) → commissions exactes par trade.
    feesFile?: { buffer: Buffer; filename: string },
    // Rapport de rapprochement des frais (out-param, non-bloquant) : lu par le controller.
    report?: { fees?: FeesReport },
  ): Promise<Partial<CreateTradeDto>[]> {
    // 1. Obtenir du texte CSV (Excel converti localement, sinon UTF-8)
    const content = this.toCsvText(buffer, filename);
    if (!content) throw new BadRequestException('Fichier vide');
    if (content.split('\n').length < 2)
      throw new BadRequestException('Fichier sans données');

    // 2. Détecter le broker et pré-normaliser
    const { broker, csv } = preprocessCsv(content);
    const normalizedLines = csv.split('\n').filter((l) => l.trim());
    if (normalizedLines.length < 2)
      throw new BadRequestException(this.emptyMessage());

    let dtos: ImportDto[];

    if (broker !== 'unknown') {
      // 3. Broker connu → parsing local, gratuit, sans IA
      const dataCount = normalizedLines.length - 1;
      if (dataCount > MAX_KNOWN_ROWS) {
        throw new BadRequestException(
          `${dataCount} trades détectés. Maximum ${MAX_KNOWN_ROWS} par import. ` +
          `Découpe ton fichier par période.`,
        );
      }
      dtos = mapNormalizedCsvToDto(csv);
      this.logger.log(`CSV "${filename}" [${broker}] → ${dtos.length} trades (local, sans IA)`);
    } else {
      // 4a. Le fichier ressemble-t-il seulement à un export de trades ? Un fichier
      //     hors sujet (image renommée .csv, tableur quelconque) renvoyait le message
      //     « broker non reconnu → passe Premium » : on vendait un upgrade qui n'aurait
      //     rien résolu, et un débutant qui se trompe de fichier comprenait « il faut
      //     payer ». Message neutre, aucun upsell, quel que soit le plan.
      if (!this.looksLikeTradeExport(normalizedLines[0] ?? '', content)) {
        throw new BadRequestException(
          "Ce fichier ne ressemble pas à un export de trades. " +
          "Vérifie que tu exportes bien l'historique de tes trades depuis ton broker (CSV ou Excel). " +
          "Formats reconnus automatiquement : Tradovate, MEXC, Binance, Bybit, MT4/5, IBKR.",
        );
      }

      // 4b. Vrai fichier de trades, mais broker inconnu → chemin IA (Anthropic) :
      //     réservé Premium + prod. Ici l'upsell est légitime : Premium résoudrait
      //     réellement le problème. Les brokers connus restent gratuits pour tous.
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

    // Fusion frais Tradovate (Performance + Cash history) → commissions exactes par trade.
    // Prioritaire sur le total manuel : ne s'applique QUE si les trades sont un Tradovate
    // Performance ET qu'un fichier de frais valide (Cash history) est fourni.
    let feesMerged = false;
    if (broker === 'tradovate' && feesFile) {
      const feesText = this.toCsvText(feesFile.buffer, feesFile.filename);
      const merge = feesText ? this.mergeTradovateFees(dtos, feesText) : null;
      if (merge) {
        feesMerged = true;
        if (report) report.fees = merge;
        this.logger.log(
          `Fusion frais Tradovate : ${merge.assigned}$ attribués sur ${merge.count} trades ` +
          `(attendu ${merge.expected}$, ${merge.reconciled ? 'rapproché' : 'écart'}).`,
        );
      } else if (report) {
        // Échec de fusion (Cash history illisible, en-tête ou colonnes non reconnues) :
        // l'import réussissait en silence, SANS aucun frais, et le P&L net affiché était
        // surestimé à l'insu de l'utilisateur. On ne bloque pas — les trades restent
        // valides — mais on remonte l'échec pour que le front puisse l'afficher.
        report.fees = { assigned: 0, expected: 0, reconciled: false, merged: false, count: dtos.length };
        this.logger.warn(
          `Frais Tradovate NON rapprochés : le Cash history "${feesFile.filename}" n'a pas pu être exploité. ` +
          `Import poursuivi sans frais (${dtos.length} trades) — P&L brut.`,
        );
      }
    }

    // Frais saisis par l'utilisateur → répartis au prorata des contrats (P&L net).
    // Ignorés si la fusion fichier a déjà posé les commissions exactes.
    // Double sécurité (le front protège déjà) : jamais d'addition par-dessus des
    // frais déjà présents dans le CSV, ni de lissage sur un gros import.
    if (!feesMerged && totalFees != null && totalFees > 0 && dtos.length > 0) {
      const hasCsvFees = dtos.some((d) => (d.commission ?? 0) > 0);
      if (hasCsvFees) {
        this.logger.warn('totalFees ignoré : frais déjà présents dans le CSV (anti double comptage).');
      } else if (dtos.length > FEES_INPUT_MAX_TRADES) {
        this.logger.warn(`totalFees ignoré : ${dtos.length} trades > ${FEES_INPUT_MAX_TRADES}.`);
      } else {
        dtos = this.distributeFees(dtos, totalFees);
      }
    }

    // Defaults appliqués à TOUT le lot : compte cible, émotion, setup.
    // - accountId : le compte choisi (validé en amont) → create() le résout ; sinon
    //   fallback backend existant (session active / compte par défaut).
    // - emotion : override OPTIONNEL. Si le lot choisit une émotion, on l'applique
    //   à tous les trades ; sinon `null` (non renseignée) → héritera de l'humeur de session à la
    //   lecture. Plus jamais de NEUTRAL forcé à l'import.
    // - setupId : choix unique, sinon « Sans setup » (créé à la volée).
    const batchEmotion = this.normalizeEmotion(defaults?.emotion);
    const setupId =
      defaults?.setupId ?? (userId ? await this.setups.getImportSetupId(userId) : null);
    for (const d of dtos) {
      if (defaults?.accountId) d.accountId = defaults.accountId;
      d.emotion = batchEmotion;
      if (setupId) d.setupId = setupId;
    }

    // Retirer les métadonnées internes (fill ids) avant persistance.
    return dtos.map((d) => {
      const clean: ImportDto = { ...d };
      delete clean._buyFillId;
      delete clean._sellFillId;
      return clean;
    });
  }

  /**
   * Valide une émotion de lot contre l'enum Prisma. Valeur absente/invalide → `null`
   * (non renseignée) : PLUS de NEUTRAL forcé. L'émotion effective sera dérivée de l'humeur
   * de session à la lecture (voir effective-emotion.util).
   */
  private normalizeEmotion(value?: string | null): EmotionState | null {
    const allowed = Object.values(EmotionState) as string[];
    return value && allowed.includes(value) ? (value as EmotionState) : null;
  }

  /**
   * Répartit un total de frais saisi par l'utilisateur sur les trades de l'import,
   * AU PRORATA de la quantité de contrats. Le P&L net est ensuite calculé
   * automatiquement par `calculatePnl` (qui déduit `commission`).
   */
  private distributeFees(
    dtos: Partial<CreateTradeDto>[],
    totalFees: number,
  ): Partial<CreateTradeDto>[] {
    const totalQty = dtos.reduce((sum, d) => sum + (d.quantity ?? 1), 0);
    if (totalQty <= 0) return dtos;

    return dtos.map((d) => {
      const qty = d.quantity ?? 1;
      const fee = +(totalFees * (qty / totalQty)).toFixed(2);
      // On additionne aux frais éventuels déjà présents (CSV), sinon on pose.
      const commission = +((d.commission ?? 0) + fee).toFixed(2);
      return { ...d, commission };
    });
  }

  /** Montant robuste en valeur absolue : retire `$`, espaces et séparateurs de milliers. */
  private parseMoneyAbs(raw: string): number {
    let s = (raw ?? '').replace(/[$\s]/g, '').trim();
    const neg = s.startsWith('(') && s.endsWith(')');
    if (neg) s = s.slice(1, -1);
    // Format US : `,` = milliers, `.` = décimale → on retire les virgules.
    s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? Math.abs(n) : 0;
  }

  /**
   * Fusion Tradovate : rapproche les commissions EXACTES par trade à partir du Cash history.
   *
   * Jointure (validée sur données réelles) : `fillId = (Transaction ID) − 1`, une entrée par fill.
   * Dédup obligatoire : un même fill peut clôturer un trade ET en ouvrir un autre (scalping) → sa
   * commission ne doit compter qu'UNE fois sur tout l'import, sinon le net est double-compté.
   * On parcourt les trades dans l'ordre du fichier avec un Set de fills consommés.
   * Garantit `Σ commission(trade) == Σ |Delta| Commission` (checksum au centime).
   *
   * Mute `commission` (positive) sur chaque DTO ; le P&L net déduit ensuite `commission`.
   * Retourne le rapport (assigned/expected/reconciled) ou null si le fichier n'est pas un Cash history.
   */
  private mergeTradovateFees(dtos: ImportDto[], feesText: string): FeesReport | null {
    const lines = feesText.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;

    const header = lines[0].toLowerCase();
    // Détection du fichier de frais : Cash history (Transaction ID + Cash Change Type).
    if (!header.includes('transaction id') || !header.includes('cash change type')) {
      this.logger.warn('Fichier de frais ignoré : en-tête Cash history non reconnu (Transaction ID / Cash Change Type).');
      return null;
    }

    const cols0 = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const iTxn = cols0.indexOf('transaction id');
    const iDelta = cols0.indexOf('delta');
    const iType = cols0.indexOf('cash change type');
    if (iTxn < 0 || iDelta < 0 || iType < 0) {
      this.logger.warn('Fichier de frais ignoré : colonnes Transaction ID / Delta / Cash Change Type introuvables.');
      return null;
    }

    // commissionParFill[fillId] = |Delta| : une entrée par ligne Commission (fillId = TxnID − 1).
    const commissionParFill = new Map<string, number>();
    let expected = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = splitCsvLine(lines[i]);
      if ((c[iType] ?? '').trim() !== 'Commission') continue; // ignore Trade Paired & co
      const txnId = parseInt((c[iTxn] ?? '').trim(), 10);
      if (!Number.isFinite(txnId)) continue;
      const amount = this.parseMoneyAbs(c[iDelta] ?? '');
      if (amount <= 0) continue;
      commissionParFill.set(String(txnId - 1), amount);
      expected += amount;
    }
    expected = +expected.toFixed(2);

    // Attribution + dédup : ordre du fichier, chaque fill consommé une seule fois
    // (règle partagée avec la synchro API, cf. tradovate-pair.util).
    const { assigned, consumed } = assignFeesOncePerFill(dtos, commissionParFill);

    const reconciled = Math.abs(assigned - expected) < 0.01;
    if (!reconciled) {
      this.logger.warn(
        `Frais Tradovate partiellement rapprochés : attribué ${assigned} vs attendu ${expected} ` +
        `(${commissionParFill.size} fills, ${consumed} consommés).`,
      );
    }
    return { assigned, expected, reconciled, count: dtos.length };
  }

  /**
   * Le fichier ressemble-t-il à un export de trades d'un broker (fût-il inconnu) ?
   *
   * Sert à ne PAS proposer l'upsell Premium quand il ne résoudrait rien : une image
   * renommée `.csv` ou un tableur hors sujet ne deviendront pas importables avec un
   * abonnement. Deux garde-fous, volontairement permissifs (on préfère laisser passer
   * un vrai export exotique vers le chemin IA que bloquer un utilisateur légitime) :
   *  - contenu binaire (octets de contrôle) → ce n'est pas un CSV ;
   *  - en-tête sans au moins deux mots du vocabulaire d'un export de trades.
   */
  private looksLikeTradeExport(header: string, content: string): boolean {
    // Une image/PDF renommé .csv contient des octets de contrôle dès les 1ers Ko
    // (on épargne \t \n \r, légitimes dans un CSV).
    const head = content.slice(0, 2000);
    for (let i = 0; i < head.length; i++) {
      const code = head.charCodeAt(i);
      const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
      if (isControl) return false;
    }

    const h = header.toLowerCase();
    const vocabulary = [
      'symbol', 'ticker', 'instrument', 'asset', 'contract', 'market', 'pair',
      'price', 'entry', 'exit', 'open', 'close', 'fill',
      'qty', 'quantity', 'size', 'volume', 'lots',
      'side', 'direction', 'type', 'buy', 'sell', 'long', 'short',
      'pnl', 'p&l', 'profit', 'realized', 'realised', 'gain',
      'date', 'time', 'timestamp',
      'commission', 'fee', 'order', 'trade', 'position',
    ];
    const hits = vocabulary.filter((word) => h.includes(word));
    return new Set(hits).size >= 2;
  }

  /**
   * Le chemin IA d'import (broker inconnu → Anthropic) n'est autorisé que :
   * - en production (garde NODE_ENV : zéro dépense IA hors prod), ET
   * - pour un accès Premium strict (PREMIUM / ADMIN / BETA_TESTER / trial actif).
   * Aligné sur PremiumGuard : l'import IA (broker inconnu) est une IA personnelle → PREMIUM.
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
        styleNote = `\nNote : Ce trader est scalper avec une fréquence élevée de trades, c'est normal pour son style.`;
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
          this.logger.warn(`CSV "${filename}" | erreurs: ${parsed.errors.join(', ')}`);
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

  /** Un appel Claude pour un lot de lignes : extrait pour le batch des gros fichiers. */
  private async callClaudeForChunk(
    chunk: string,
    filename: string,
    styleNote: string,
    userId?: string,
  ): Promise<ClaudeResponse> {
    const prompt = this.buildPrompt(filename, chunk, styleNote);
    const response = await this.anthropicClient.create(
      {
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
      },
      { feature: 'csv_import', userId: userId ?? null },
    );

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

    return { ...parsed, trades: parsed.trades, errors: parsed.errors ?? [], skipped: parsed.skipped ?? 0 };
  }

  private emptyMessage(): string {
    return (
      'Aucun trade fermé détecté dans ce fichier. Sur ton broker, exporte ' +
      "l'historique des positions/trades fermés, pas les ordres en cours."
    );
  }

  // ── Prétraitement ───────────────────────────────────────────────────────────

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
        emotion: null, // override optionnel : réassigné par le lot (ou null) dans parseCSV
        // setupId affecté en aval (parseCSV) : setup par défaut du user, ou fourni par l'import.
        session: detectSession(t.tradedAt),
        timeframe: '1h',
        tradedAt: t.tradedAt,
        notes: t.notes ?? undefined,
      }));
  }

}
