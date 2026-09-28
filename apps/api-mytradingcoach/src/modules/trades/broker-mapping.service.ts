import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  applyMappingWithPnlCheck,
  headerSignature,
  validateMappingShape,
  type CsvMapping,
  type MappingOutcome,
} from './csv-mapping';
import { splitCsvLine } from './csv-parsers';

/**
 * Registre des fiches de parsing : une fiche par broker, deduite une fois par un modele,
 * validee par un admin, puis reutilisee pour TOUS les utilisateurs — gratuits compris.
 *
 * Pourquoi ce registre existe : sans lui, chaque nouveau broker demandait d'ecrire un parseur
 * TypeScript, donc un build et un deploiement. Les fiches vivant en base, un broker signale
 * par un utilisateur se debloque depuis n'importe ou, sans livrer de code.
 *
 * Ce que ce service ne fait PAS : appeler le modele. La deduction reste dans
 * CsvImportService, seul endroit qui parle a Anthropic. Ici on lit, on valide, on applique.
 */
@Injectable()
export class BrokerMappingService {
  private readonly logger = new Logger(BrokerMappingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fiche correspondant a cet en-tete, ou null. Une fiche dont le JSON ne passe plus la
   * validation de forme est ignoree plutot que d'etre appliquee a moitie : le schema de
   * `CsvMapping` peut evoluer alors que des fiches anciennes dorment en base.
   */
  async findByHeader(header: string): Promise<{ id: string; mapping: CsvMapping } | null> {
    const hash = headerSignature(header);
    const fiche = await this.prisma.brokerCsvMapping
      .findUnique({ where: { headerHash: hash } })
      .catch(() => null);
    if (!fiche || !fiche.enabled) return null;

    let brut: unknown;
    try {
      brut = JSON.parse(fiche.mappingJson);
    } catch {
      this.logger.error(`Fiche ${fiche.id} (${fiche.brokerName}) : JSON illisible, ignoree.`);
      return null;
    }

    const sep = (brut as { delimiter?: unknown }).delimiter;
    const nbColonnes = splitCsvLine(
      header,
      typeof sep === 'string' && sep.length === 1 ? sep : ',',
    ).length;

    const mapping = validateMappingShape(brut, nbColonnes);
    if (!mapping) {
      this.logger.error(
        `Fiche ${fiche.id} (${fiche.brokerName}) : forme invalide pour cet en-tete, ignoree.`,
      );
      return null;
    }
    return { id: fiche.id, mapping };
  }

  /** Compteur d'usage : repere les fiches qui portent le plus d'imports. Jamais bloquant. */
  async noteUsage(id: string): Promise<void> {
    await this.prisma.brokerCsvMapping
      .update({ where: { id }, data: { usageCount: { increment: 1 } } })
      .catch(() => undefined);
  }

  /**
   * Applique une fiche a un fichier. Le resultat porte le taux de coherence du P&L : c'est
   * lui, et pas la confiance dans le modele, qui dit si le sens est fiable.
   */
  apply(dataLines: string[], mapping: CsvMapping): MappingOutcome {
    return applyMappingWithPnlCheck(dataLines, mapping);
  }

  // ── Administration ────────────────────────────────────────────────────────────

  async list(): Promise<
    Array<{
      id: string; brokerName: string; headerSample: string; pnlConfidence: number;
      enabled: boolean; usageCount: number; createdAt: Date;
    }>
  > {
    return this.prisma.brokerCsvMapping.findMany({
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, brokerName: true, headerSample: true, pnlConfidence: true,
        enabled: true, usageCount: true, createdAt: true,
      },
    });
  }

  /**
   * Enregistre une fiche validee par un admin. `headerHash` est derive de l'en-tete, jamais
   * fourni par l'appelant : deux fiches ne doivent pas pouvoir revendiquer le meme en-tete.
   */
  async save(params: {
    header: string;
    brokerName: string;
    mapping: CsvMapping;
    pnlConfidence: number;
    validatedById: string;
  }): Promise<{ id: string }> {
    const hash = headerSignature(params.header);
    const data = {
      brokerName: params.brokerName.trim(),
      headerSample: params.header,
      mappingJson: JSON.stringify(params.mapping),
      pnlConfidence: params.pnlConfidence,
      validatedById: params.validatedById,
      enabled: true,
    };
    const fiche = await this.prisma.brokerCsvMapping.upsert({
      where: { headerHash: hash },
      create: { headerHash: hash, ...data },
      update: data,
    });
    this.logger.log(
      `Fiche broker enregistree : ${data.brokerName} (sens confirme a ` +
      `${Math.round(params.pnlConfidence * 100)} %, fiche ${fiche.id}).`,
    );
    return { id: fiche.id };
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.prisma.brokerCsvMapping.update({ where: { id }, data: { enabled } });
    this.logger.log(`Fiche broker ${id} ${enabled ? 'reactivee' : 'desactivee'}.`);
  }
}
