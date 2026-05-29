import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Role, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { getTickValue, getTickSize, INSTRUMENTS } from './instruments.const';

export interface UserAssetItem {
  symbol: string;
  label: string;
  category: string;
  tradeCount: number;
  lastEntry: number | null;
  lastQty: number | null;
  isFavorite: boolean;
}

@Injectable()
export class TradesService {
  constructor(private prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateTradeDto,
    plan: Plan = Plan.FREE,
    role: Role = Role.USER,
  ) {
    await this.checkMonthlyLimit(userId, plan, role);
    const pnl = this.calculatePnl(dto);
    const riskReward = this.calculateRiskReward(dto);
    return this.prisma.trade.create({
      data: {
        ...dto,
        pnl: dto.pnl ?? pnl,
        riskReward: dto.riskReward ?? riskReward,
        quantity: dto.quantity ?? 1,
        capitalEngaged: dto.capitalEngaged ?? null,
        userId,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : new Date(),
      },
    });
  }

  async findAll(userId: string, filters: TradeFiltersDto) {
    const {
      cursor,
      limit = 20,
      side,
      setup,
      emotion,
      dateFrom,
      dateTo,
    } = filters;
    const where: Prisma.TradeWhereInput = { userId };
    if (side) where.side = side;
    if (setup) where.setup = setup;
    if (emotion) where.emotion = emotion;
    if (dateFrom || dateTo) {
      where.tradedAt = {};
      if (dateFrom) where.tradedAt.gte = new Date(dateFrom);
      if (dateTo) where.tradedAt.lte = new Date(dateTo);
    }

    const trades = await this.prisma.trade.findMany({
      take: limit + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      orderBy: { tradedAt: 'desc' },
    });

    const hasNextPage = trades.length > limit;
    const data = hasNextPage ? trades.slice(0, limit) : trades;
    const nextCursor = hasNextPage ? data[data.length - 1].id : null;

    return { data, nextCursor, hasNextPage };
  }

  async findOne(userId: string, id: string) {
    const trade = await this.prisma.trade.findUnique({ where: { id } });
    if (!trade) throw new NotFoundException('Trade introuvable');
    if (trade.userId !== userId) throw new ForbiddenException();
    return trade;
  }

  async update(userId: string, id: string, dto: UpdateTradeDto) {
    const existing = await this.findOne(userId, id);

    const merged = { ...existing, ...dto } as CreateTradeDto;

    const priceFieldsChanged =
      dto.entry !== undefined ||
      dto.exit !== undefined ||
      dto.quantity !== undefined ||
      dto.commission !== undefined ||
      dto.pnl !== undefined;

    const newPnl = priceFieldsChanged ? this.calculatePnl(merged) : undefined;
    const newRR = priceFieldsChanged ? this.calculateRiskReward(merged) : undefined;

    return this.prisma.trade.update({
      where: { id },
      data: {
        ...dto,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : undefined,
        ...(newPnl !== undefined ? { pnl: newPnl } : {}),
        ...(newRR !== undefined ? { riskReward: newRR } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.trade.delete({ where: { id } });
  }

  async checkMonthlyLimit(
    userId: string,
    plan: Plan,
    role: Role = Role.USER,
  ): Promise<void> {
    if (role === Role.ADMIN || role === Role.BETA_TESTER || plan === Plan.STARTER || plan === Plan.PREMIUM)
      return;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const count = await this.prisma.trade.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    });

    if (count >= 30) {
      throw new HttpException(
        {
          code: 'FREE_LIMIT_REACHED',
          message: 'Limite de 30 trades/mois atteinte',
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async countThisMonth(userId: string, plan: Plan, role: Role = Role.USER): Promise<{ count: number; limit: number; isPremium: boolean }> {
    const isPremium = plan === Plan.STARTER || plan === Plan.PREMIUM || role === Role.ADMIN || role === Role.BETA_TESTER;
    if (isPremium) return { count: 0, limit: 0, isPremium: true };

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const count = await this.prisma.trade.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    });

    return { count, limit: 30, isPremium: false };
  }

  async getUserAssets(userId: string): Promise<UserAssetItem[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tradingAssets: true, favoriteAsset: true },
    });
    const favoriteAsset = user?.favoriteAsset ?? null;
    const instrMap = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

    // Si l'user a configuré ses actifs → priorité au profil
    if (user?.tradingAssets?.length) {
      return user.tradingAssets.map((symbol) => {
        const instr = instrMap.get(symbol);
        return {
          symbol,
          label: instr?.label ?? symbol,
          category: instr?.category ?? 'CRYPTO',
          tradeCount: 0,
          lastEntry: null,
          lastQty: null,
          isFavorite: symbol === favoriteAsset,
        };
      });
    }

    // Fallback : top actifs sur les 100 derniers trades (tous mois confondus)
    const rows = await this.prisma.trade.findMany({
      where: { userId },
      select: { asset: true, entry: true, quantity: true, tradedAt: true },
      orderBy: { tradedAt: 'desc' },
      take: 100,
    });

    const map = new Map<string, { count: number; lastEntry: number | null; lastQty: number | null }>();
    for (const row of rows) {
      if (!map.has(row.asset)) {
        map.set(row.asset, { count: 0, lastEntry: row.entry, lastQty: row.quantity });
      }
      map.get(row.asset)!.count++;
    }

    const items: UserAssetItem[] = Array.from(map.entries()).map(([symbol, data]) => {
      const instr = instrMap.get(symbol);
      return {
        symbol,
        label: instr?.label ?? symbol,
        category: instr?.category ?? 'CRYPTO',
        tradeCount: data.count,
        lastEntry: data.lastEntry,
        lastQty: data.lastQty,
        isFavorite: symbol === favoriteAsset,
      };
    });

    items.sort((a, b) => b.tradeCount - a.tradeCount);

    if (favoriteAsset && !items.find((i) => i.symbol === favoriteAsset)) {
      const instr = instrMap.get(favoriteAsset);
      items.unshift({
        symbol: favoriteAsset,
        label: instr?.label ?? favoriteAsset,
        category: instr?.category ?? 'CRYPTO',
        tradeCount: 0,
        lastEntry: null,
        lastQty: null,
        isFavorite: true,
      });
    }

    return items.slice(0, 8);
  }

  async saveUserAssets(
    userId: string,
    assets: string[],
    favoriteAsset?: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        tradingAssets: assets,
        favoriteAsset: favoriteAsset ?? null,
      },
    });
  }

  async setFavoriteAsset(userId: string, asset: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { favoriteAsset: asset },
    });
  }

  private calculatePnl(dto: CreateTradeDto): number | undefined {
    if (dto.entry == null || dto.entry <= 0) return undefined;

    const commission = Math.abs(dto.commission ?? 0);

    let effectiveExit: number | undefined;
    if (dto.exit != null && dto.exit > 0) {
      effectiveExit = dto.exit;
    } else if (dto.pnl != null) {
      return +(dto.pnl - commission).toFixed(2);
    }

    if (effectiveExit == null) return undefined;

    const points =
      dto.side === 'LONG'
        ? effectiveExit - dto.entry
        : dto.entry - effectiveExit;

    const quantity = dto.quantity ?? 1;
    const tickValue = getTickValue(dto.asset);
    const tickSize = getTickSize(dto.asset);

    let pnl: number;
    if (tickValue != null) {
      const ticks = tickSize && tickSize > 0 ? points / tickSize : points;
      pnl = ticks * tickValue * quantity;
    } else if (dto.capitalEngaged != null && dto.capitalEngaged > 0) {
      pnl = (points / dto.entry) * dto.capitalEngaged;
    } else {
      pnl = points * quantity;
    }

    pnl -= commission;

    return +pnl.toFixed(2);
  }

  private calculateRiskReward(dto: CreateTradeDto): number | undefined {
    // R/R calculé depuis takeProfit (objectif prévu), pas exit (sortie réelle)
    if (dto.entry != null && dto.takeProfit != null && dto.stopLoss != null) {
      const reward =
        dto.side === 'LONG'
          ? dto.takeProfit - dto.entry
          : dto.entry - dto.takeProfit;
      const risk = Math.abs(dto.entry - dto.stopLoss);
      return risk > 0 && reward > 0 ? +(reward / risk).toFixed(2) : undefined;
    }
    return undefined;
  }
}
