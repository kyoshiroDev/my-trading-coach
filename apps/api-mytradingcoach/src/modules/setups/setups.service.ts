import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSetupDto } from './dto/create-setup.dto';
import { UpdateSetupDto } from './dto/update-setup.dto';
import { seedDefaultSetups } from './setups.defaults';

/** Titre du setup où atterrissent les trades importés sans setup choisi. */
export const IMPORT_SETUP_TITLE = 'Sans setup';

@Injectable()
export class SetupsService {
  private readonly logger = new Logger(SetupsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Crée les 6 setups par défaut pour un nouvel utilisateur (idempotent). */
  seedDefaults(userId: string): Promise<boolean> {
    return seedDefaultSetups(this.prisma, userId);
  }

  /** Liste des setups du user (actifs + archivés), triée par sortOrder, avec nb de trades. */
  async list(userId: string) {
    const setups = await this.prisma.setup.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { trades: true } } },
    });
    return setups.map((s) => ({
      id: s.id,
      title: s.title,
      color: s.color,
      description: s.description,
      sortOrder: s.sortOrder,
      archived: s.archived,
      tradeCount: s._count.trades,
    }));
  }

  async create(userId: string, dto: CreateSetupDto) {
    const max = await this.prisma.setup.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });
    const sortOrder = (max._max.sortOrder ?? -1) + 1;
    return this.prisma.setup.create({
      data: {
        userId,
        title: dto.title.trim(),
        color: dto.color,
        description: dto.description?.trim() || null,
        sortOrder,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateSetupDto) {
    await this.assertOwned(userId, id);
    return this.prisma.setup.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      },
    });
  }

  async archive(userId: string, id: string) {
    await this.assertOwned(userId, id);
    return this.prisma.setup.update({ where: { id }, data: { archived: true } });
  }

  async restore(userId: string, id: string) {
    await this.assertOwned(userId, id);
    return this.prisma.setup.update({ where: { id }, data: { archived: false } });
  }

  /** Suppression franche : autorisée uniquement si le setup n'a aucun trade rattaché. */
  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    const count = await this.prisma.trade.count({ where: { setupId: id } });
    if (count > 0) {
      throw new BadRequestException(
        'Ce setup a un historique de trades : archive-le plutôt que de le supprimer.',
      );
    }
    await this.prisma.setup.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Setup des trades IMPORTÉS sans setup choisi (synchro broker, import CSV) : « Sans setup »,
   * créé à la volée s'il n'existe pas (ou désarchivé). Avant, ils tombaient sur le premier setup
   * du user (souvent « Breakout ») : les stats par setup attribuaient à une stratégie des trades
   * que le trader n'y avait jamais rangés (PROMPT-213). Le trader les reclasse ensuite.
   */
  async getImportSetupId(userId: string): Promise<string> {
    const existing = await this.prisma.setup.findFirst({
      where: { userId, title: IMPORT_SETUP_TITLE },
      orderBy: { archived: 'asc' },
      select: { id: true, archived: true },
    });
    if (existing) {
      if (existing.archived) {
        await this.prisma.setup.update({ where: { id: existing.id }, data: { archived: false } });
      }
      return existing.id;
    }
    const created = await this.prisma.setup.create({
      data: {
        userId,
        title: IMPORT_SETUP_TITLE,
        color: '#6b7280',
        description: 'Trades importés (synchro broker, CSV) pas encore rangés dans un setup.',
        sortOrder: 999,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Valide qu'un setup appartient au user ET est actif (création de trade). */
  async assertOwnedActive(userId: string, setupId: string): Promise<void> {
    const s = await this.prisma.setup.findFirst({
      where: { id: setupId, userId, archived: false },
      select: { id: true },
    });
    if (!s) {
      throw new BadRequestException('Setup invalide (inconnu, archivé, ou hors de ton compte).');
    }
  }

  /**
   * Résout le setup d'un import EN LOT, sans jamais jeter.
   *
   * Un id périmé (inconnu, archivé, hors compte) ne doit pas faire rejeter des
   * dizaines de trades : le front pouvait envoyer le setup présélectionné à
   * l'ouverture du wizard puis supprimé à l'étape suivante — tout l'import
   * partait alors en 400 (bug Val). On retombe sur « Sans setup » (`getImportSetupId`).
   *
   * Volontairement distinct d'`assertOwnedActive`, qui reste STRICT pour la
   * création manuelle d'un trade : là, le setup est un choix explicite de
   * l'utilisateur sur un seul trade, une erreur doit se voir immédiatement.
   */
  async resolveBatchSetupId(userId: string, setupId?: string): Promise<string | null> {
    if (setupId) {
      const owned = await this.prisma.setup.findFirst({
        where: { id: setupId, userId, archived: false },
        select: { id: true },
      });
      if (owned) return owned.id;
      // Trace le repli : sans ça, un front qui envoie durablement un id périmé
      // passe inaperçu (les trades atterrissent silencieusement sur le défaut).
      this.logger.warn(
        `Import : setupId ${setupId} invalide pour le user ${userId} → repli sur « ${IMPORT_SETUP_TITLE} ».`,
      );
    }
    return this.getImportSetupId(userId);
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const setup = await this.prisma.setup.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!setup) throw new NotFoundException('Setup introuvable');
  }
}
