import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Plan, Role, EmotionState } from '@prisma/client';
import * as XLSX from 'xlsx';
import type { CreateTradeDto } from './dto/create-trade.dto';
import { AnthropicClientService, responseText } from '../infra/anthropic-client.service';
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
import {
  applyMappingWithPnlCheck,
  MAPPING_MIN_PARSED_RATIO,
  MAPPING_MIN_PNL_RATIO,
  MAPPING_SAMPLE_ROWS,
  validateMappingShape,
  type CsvMapping,
} from './csv-mapping';
import { BrokerMappingService } from './broker-mapping.service';
import { AI_MODELS } from '../infra/ai-pricing.const';

const MODEL = AI_MODELS.analysis;


// Limites différenciées : un broker connu est parsé localement (sans IA),
// l'inconnu passe par Claude par lots bornés pour maîtriser le coût.
const MAX_KNOWN_ROWS = 10_000;

// Au-delà, un total global réparti au prorata donnerait des frais lissés faux :
// on désactive la saisie d'un total des frais (front) et on l'ignore (back).
const FEES_INPUT_MAX_TRADES = 5000;
const MAX_AI_ROWS = 2000;
/** Plafond de sortie d'un lot du repli ligne a ligne. */
export const AI_CHUNK_MAX_TOKENS = 8192;
/**
 * Pire cout de sortie mesure par trade rendu, sur le modele d'analyse (Sonnet 4.6,
 * 2026-10-08, colonne de notes remplie) : jusqu'a 5 528 jetons pour un lot de 40 lignes,
 * soit ~138 par trade, et ~70 a 95 le plus souvent. La sortie varie d'un lot a l'autre ;
 * les nombres se decoupent mal : on est loin des ~40 jetons supposes a l'origine.
 */
export const WORST_TOKENS_PER_TRADE = 140;
/**
 * Lignes par appel Claude. Ce n'est PAS un reglage de cout mais une contrainte de
 * sortie : au-dela du plafond, la reponse est tronquee, `JSON.parse` echoue et
 * l'import echoue apres avoir paye l'appel. A 120 lignes, Sonnet 4.6 atteignait les
 * 8192 jetons ; a 40, deux lots sur sept montaient a 64-67 % (mesures 2026-10-08). A 25,
 * le pire cas tient en ~3 500 jetons : moins de la moitie du plafond, marge de 50 % au
 * moins (verifie par le test du lot).
 *
 * Baisser ce lot ne coute quasiment rien : la sortie est proportionnelle au nombre
 * de trades, et seule l'entete de prompt (~250 jetons) est repetee par appel.
 */
export const AI_BATCH = 25;

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
    private readonly brokerMappings: BrokerMappingService,
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
      // 3bis. Fiche du registre pour cet en-tete ? Alors c'est un broker connu comme les
      //       autres : parsing local, gratuit, ACCESSIBLE A TOUS LES PLANS. C'est le but du
      //       registre — un broker debloque une fois profite ensuite a chaque utilisateur,
      //       sans appel IA et sans deploiement. Passe donc avant le verrou Premium.
      const fiche = await this.brokerMappings.findByHeader(normalizedLines[0] ?? '');
      const parFiche = fiche
        ? this.parseAvecFiche(normalizedLines.slice(1), fiche, filename)
        : null;

      if (parFiche && fiche) {
        void this.brokerMappings.noteUsage(fiche.id);
        dtos = parFiche;
      } else {
      // Aucune fiche, ou fiche devenue inapplicable (le broker a change son format) : la
      // suite reprend exactement le parcours d'un broker inconnu.

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

    // Chemin prefere : UN appel pour deduire les colonnes, puis parsing local. Il est tente
    // AVANT le plafond de MAX_AI_ROWS, parce que son cout ne depend pas de la taille du
    // fichier : un export de 10 000 lignes coute le meme appel qu'un de 50.
    const parMapping = await this.tryMappingPath(normalizedLines, dataLines, filename, userId);
    if (parMapping) return parMapping;

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

  // ── Registre des brokers : entrees publiques pour l'admin ────────────────────

  /**
   * Deduit une fiche depuis un echantillon colle ou televerse dans l'admin. UN appel IA.
   *
   * Pas de garde `NODE_ENV` ici, contrairement au chemin d'import : c'est une action
   * deliberee d'un admin, et le client Anthropic refuse deja tout appel quand `AI_ENABLED`
   * n'est pas vrai. C'est donc cette variable qui autorise ou non la depense, par
   * environnement, sans qu'on ait besoin de reserver la fonction a la production.
   */
  async analyseSampleForAdmin(sample: string): Promise<{
    header: string;
    mapping: CsvMapping | null;
    preview: ReturnType<CsvImportService['mapToDto']>;
    pnlRatio: number | null;
    flipped: boolean;
    skipped: number;
    rowsRead: number;
    fraisAdditionnes: number[];
  } | null> {
    const lignes = this.normaliserEchantillon(sample);
    if (lignes.length < 2) return null;

    const mapping = await this.inferMapping(lignes);
    return { ...this.previewForAdmin(lignes, mapping), header: lignes[0] };
  }

  /**
   * L'echantillon colle par l'admin, passe par LA MEME normalisation que le chemin d'import.
   *
   * Indispensable, et decouvert en testant de bout en bout : un export en point-virgule avec
   * des decimales a la virgule (« 29657,50;1,24 USD ») est converti par `preprocessCsv` en
   * virgule/point avant d'atteindre le registre. Si l'admin deduisait la fiche sur le texte
   * BRUT, elle porterait `delimiter: ';'` et une signature calculee sur des point-virgules,
   * alors que l'import cherche une signature calculee sur des virgules : la fiche ne
   * matcherait jamais. Passer par la meme fonction garantit l'accord par construction.
   */
  /** Meme normalisation, exposee au controleur admin pour que preview et save concordent. */
  normaliserEchantillonPublic(sample: string): string[] {
    return this.normaliserEchantillon(sample);
  }

  private normaliserEchantillon(sample: string): string[] {
    return preprocessCsv(sample)
      .csv.split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.trim());
  }

  /** Broker deja reconnu nativement : une fiche serait inutile. */
  brokerDejaSupporte(sample: string): string | null {
    const { broker } = preprocessCsv(sample);
    return broker === 'unknown' ? null : broker;
  }

  /**
   * Rejoue une fiche, corrigee a la main ou non, sur l'echantillon. AUCUN appel IA : c'est ce
   * qui permet a un admin d'ajuster une colonne et de revoir l'apercu autant de fois qu'il
   * veut sans que cela coute quoi que ce soit.
   */
  previewForAdmin(
    lignes: string[],
    mapping: CsvMapping | null,
  ): {
    mapping: CsvMapping | null;
    preview: ReturnType<CsvImportService['mapToDto']>;
    pnlRatio: number | null;
    flipped: boolean;
    skipped: number;
    rowsRead: number;
    fraisAdditionnes: number[];
  } {
    const donnees = lignes.slice(1);
    if (!mapping) {
      return {
        mapping: null, preview: [], pnlRatio: null, flipped: false,
        skipped: donnees.length, rowsRead: donnees.length, fraisAdditionnes: [],
      };
    }
    const out = applyMappingWithPnlCheck(donnees, mapping);
    return {
      // La fiche rendue est celle REELLEMENT appliquee : sens redresse et ordre jour/mois
      // corrige. L'admin doit enregistrer celle-la, pas celle qu'il a envoyee.
      mapping: out.mapping,
      preview: this.mapToDto(out.rows),
      pnlRatio: out.pnlRatio,
      flipped: out.flipped,
      skipped: out.skipped,
      rowsRead: donnees.length,
      fraisAdditionnes: out.fraisAdditionnes,
    };
  }

  /**
   * Applique une fiche du registre. Rend null si elle ne tient plus, et l'import repart alors
   * sur le parcours « broker inconnu » : un broker qui change son format ne doit pas produire
   * des trades faux, il doit redevenir inconnu le temps qu'on refasse sa fiche.
   *
   * Le meme controle qu'a la validation est rejoue A CHAQUE import, et ce n'est pas
   * redondant : la fiche a ete validee sur 20 lignes d'UN utilisateur, elle s'applique ici
   * au fichier entier d'un AUTRE. Si le sens ne colle plus aux chiffres, on renonce.
   */
  private parseAvecFiche(
    dataLines: string[],
    fiche: { id: string; mapping: CsvMapping },
    filename: string,
  ): ReturnType<CsvImportService['mapToDto']> | null {
    if (!dataLines.length) return null;
    const out = this.brokerMappings.apply(dataLines, fiche.mapping);

    const ratioParse = out.rows.length / dataLines.length;
    if (ratioParse < MAPPING_MIN_PARSED_RATIO) {
      this.logger.warn(
        `Fiche ${fiche.id} ecartee pour "${filename}" : ${out.rows.length}/${dataLines.length} ` +
        `lignes exploitables. Le format du broker a probablement change.`,
      );
      return null;
    }
    if (out.pnlRatio != null && out.pnlRatio < MAPPING_MIN_PNL_RATIO) {
      this.logger.warn(
        `Fiche ${fiche.id} ecartee pour "${filename}" : sens confirme sur seulement ` +
        `${Math.round(out.pnlRatio * 100)} % des lignes testables.`,
      );
      return null;
    }

    this.logger.log(
      `CSV "${filename}" [fiche ${fiche.id}] -> ${out.rows.length} trades (local, sans IA)` +
      `${out.flipped ? ', sens redresse par le controle du P&L' : ''}.`,
    );
    return this.mapToDto(out.rows);
  }

  /**
   * Chemin mapping : un appel pour deduire les colonnes, puis parsing local du fichier entier.
   *
   * Rend `null` des que quelque chose ne tient pas, et l'appelant retombe sur le chemin ligne
   * par ligne. On prefere un import cher a un import faux : une inversion du sens transformerait
   * tous les longs en shorts sans qu'aucune erreur ne remonte.
   *
   * Trois raisons de renoncer :
   *  - le modele n'a pas rendu un mapping exploitable ;
   *  - trop de lignes inexploitables (seuil MAPPING_MIN_PARSED_RATIO) ;
   *  - le sens n'est pas VERIFIABLE par le signe du P&L. C'est le cas d'un export sans prix
   *    d'entree (type Binance Futures), et c'est precisement le format sur lequel les deux
   *    modeles se sont trompes de sens a la mesure du 2026-09-28. Sans controle arithmetique,
   *    on ne prend pas le risque.
   */
  private async tryMappingPath(
    normalizedLines: string[],
    dataLines: string[],
    filename: string,
    userId?: string,
  ): Promise<Partial<CreateTradeDto>[] | null> {
    if (!dataLines.length) return null;

    let mapping: CsvMapping | null;
    try {
      mapping = await this.inferMapping(normalizedLines, userId);
    } catch (err) {
      this.logger.warn(`Mapping non deduit pour "${filename}" : ${(err as Error).message}`);
      return null;
    }
    if (!mapping) return null;

    const out = applyMappingWithPnlCheck(dataLines, mapping);

    const ratioParse = out.rows.length / dataLines.length;
    if (ratioParse < MAPPING_MIN_PARSED_RATIO) {
      this.logger.warn(
        `Mapping ecarte pour "${filename}" : ${out.rows.length}/${dataLines.length} lignes ` +
        `exploitables (seuil ${MAPPING_MIN_PARSED_RATIO}).`,
      );
      return null;
    }

    if (out.pnlRatio == null) {
      this.logger.warn(
        `Mapping ecarte pour "${filename}" : le sens n'est pas verifiable par le signe du P&L ` +
        `(pas de prix d'entree exploitable). Repli sur l'analyse ligne par ligne.`,
      );
      return null;
    }

    this.logger.log(
      `Import par mapping pour "${filename}" : ${out.rows.length} trade(s), ` +
      `sens confirme sur ${Math.round(out.pnlRatio * 100)} % des lignes testables` +
      `${out.flipped ? ' (sens INVERSE par rapport au mapping deduit)' : ''}. Un seul appel IA.`,
    );

    return this.mapToDto(out.rows);
  }

  /**
   * L'unique appel IA du chemin mapping : l'echantillon suffit, le fichier entier n'est jamais
   * envoye. Le modele rapide fait l'affaire (mesure : colonnes justes 29/30 contre 30/30 pour
   * le modele d'analyse, a un tiers du prix) et le sens, la ou il se trompe, est de toute facon
   * retranche par le controle arithmetique.
   */
  private async inferMapping(
    normalizedLines: string[],
    userId?: string,
  ): Promise<CsvMapping | null> {
    const echantillon = normalizedLines.slice(0, MAPPING_SAMPLE_ROWS + 1).join('\n');

    const prompt = `Voici les premieres lignes d'un export de trades d'un broker inconnu.
Deduis la correspondance des colonnes pour parser le fichier ENTIER sans le relire.
Les index commencent a 0. Certains brokers exportent la ligne de CLOTURE d'une position :
la colonne de sens designe alors l'ordre de sortie.

Reponds UNIQUEMENT avec ce JSON, sans texte autour :
{
  "delimiter": "<le separateur de colonnes, un seul caractere>",
  "decimalSeparator": "." ou ",",
  "dateFormat": "dmy" si les dates sont jour/mois/annee, "mdy" si mois/jour/annee, "iso" si annee en premier,
  "columns": {
    "symbol": <index>, "entry": <index ou null si le fichier ne donne pas le prix d'entree>,
    "exit": <index>, "quantity": <index>, "pnl": <index>,
    "tradedAt": <index de la date de CLOTURE>
  },
  "side": {
    "mode": "column" si le sens est dans une colonne, sinon "derived_from_timestamps",
    "index": <index de la colonne de sens, ou null>,
    "longValues": [<valeurs signifiant LONG>], "shortValues": [<valeurs signifiant SHORT>],
    "buyTimeIndex": <index ou null>, "sellTimeIndex": <index ou null>
  },
  "pnlExtraColumns": [<index a ADDITIONNER au pnl, par exemple commission et swap, sinon vide>],
  "notes": "<pieges de format rencontres>"
}

FICHIER :
${echantillon}`;

    const response = await this.anthropicClient.create(
      {
        model: AI_MODELS.fast,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      },
      { feature: 'csv_mapping', userId: userId ?? null },
    );

    if (response.stop_reason === 'max_tokens') return null;

    const brut = responseText(response);
    // Le modele peut preceder le JSON d'une explication : on prend le bloc, sinon les accolades.
    const bloc = brut.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidat = bloc
      ? bloc[1]
      : brut.slice(brut.indexOf('{'), brut.lastIndexOf('}') + 1);

    try {
      const propose = JSON.parse(candidat.trim()) as { delimiter?: unknown };
      // Le nombre de colonnes se compte avec LE separateur que le modele a reconnu, pas avec
      // la virgule par defaut : un export en point-virgule (MEXC) ne fait qu'une colonne vu
      // a la virgule, et tous les index seraient alors juges hors limites.
      const sep = typeof propose.delimiter === 'string' && propose.delimiter.length === 1
        ? propose.delimiter
        : ',';
      const nbColonnes = splitCsvLine(normalizedLines[0] ?? '', sep).length;
      return validateMappingShape(propose, nbColonnes);
    } catch {
      return null;
    }
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
        max_tokens: AI_CHUNK_MAX_TOKENS,
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

    // Reponse coupee par max_tokens : le JSON est incomplet, donc `JSON.parse` va
    // echouer sur un fichier parfaitement valide. Sans ce test, le message affiche
    // accuse le fichier de l'utilisateur au lieu de dire la verite.
    if (response.stop_reason === 'max_tokens') {
      this.logger.error(
        `Reponse Claude tronquee (max_tokens) pour "${filename}" : lot de ${AI_BATCH} lignes trop gros.`,
      );
      throw new BadRequestException(
        "Ce fichier contient trop d'informations par ligne pour etre importe d'un bloc. " +
        'Reessaie en le coupant en deux moities.',
      );
    }

    const text = responseText(response);
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
