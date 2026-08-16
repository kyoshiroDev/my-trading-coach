import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSetupDto } from './dto/create-setup.dto';
import { UpdateSetupDto } from './dto/update-setup.dto';
import { seedDefaultSetups } from './setups.defaults';

@Injectable()
export class SetupsService {
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

  /** Setup par défaut du user (sortOrder le plus bas, non archivé) : fallback import CSV. */
  async getDefaultSetupId(userId: string): Promise<string | null> {
    const s = await this.prisma.setup.findFirst({
      where: { userId, archived: false },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    return s?.id ?? null;
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

  private async assertOwned(userId: string, id: string): Promise<void> {
    const setup = await this.prisma.setup.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!setup) throw new NotFoundException('Setup introuvable');
  }
}
