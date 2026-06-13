import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, TradingAccount } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liste des comptes du user : actifs d'abord, archivés ensuite. */
  async list(userId: string): Promise<TradingAccount[]> {
    // Ordre enum Postgres = ordre de déclaration (ACTIVE < PASSED < FAILED < ARCHIVED).
    return this.prisma.tradingAccount.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateAccountDto): Promise<TradingAccount> {
    return this.prisma.tradingAccount.create({ data: { userId, ...dto } });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<TradingAccount> {
    await this.assertOwner(userId, id);
    return this.prisma.tradingAccount.update({ where: { id }, data: dto });
  }

  /**
   * Suppression : hard delete si le compte est vide, sinon archivage (l'historique
   * reste rattaché au compte archivé). On refuse d'archiver le DERNIER compte actif
   * portant de l'historique, pour ne jamais laisser le user sans compte actif où
   * rattacher ses prochains trades (cf. défaut anti-NULL de l'ÉTAPE 4).
   */
  async remove(
    userId: string,
    id: string,
  ): Promise<{ deleted?: boolean; archived?: boolean }> {
    const account = await this.assertOwner(userId, id);

    const [tradeCount, sessionCount] = await Promise.all([
      this.prisma.trade.count({ where: { accountId: id } }),
      this.prisma.tradeSession.count({ where: { accountId: id } }),
    ]);
    const hasHistory = tradeCount > 0 || sessionCount > 0;

    if (!hasHistory) {
      await this.prisma.tradingAccount.delete({ where: { id } });
      return { deleted: true };
    }

    if (account.status === AccountStatus.ACTIVE) {
      const activeCount = await this.prisma.tradingAccount.count({
        where: { userId, status: AccountStatus.ACTIVE },
      });
      if (activeCount <= 1) {
        throw new BadRequestException(
          "Garde au moins un compte actif. Crée-en un autre avant d'archiver celui-ci.",
        );
      }
    }

    await this.prisma.tradingAccount.update({
      where: { id },
      data: { status: AccountStatus.ARCHIVED },
    });
    return { archived: true };
  }

  /** Vérifie que le compte existe ET appartient au user (sinon 404, sans fuite d'existence). */
  private async assertOwner(
    userId: string,
    id: string,
  ): Promise<TradingAccount> {
    const account = await this.prisma.tradingAccount.findUnique({ where: { id } });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Compte introuvable.');
    }
    return account;
  }
}
