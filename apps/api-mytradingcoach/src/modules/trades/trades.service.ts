import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';

@Injectable()
export class TradesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateTradeDto, plan: Plan = Plan.FREE) {
    await this.checkMonthlyLimit(userId, plan);
    const pnl = this.calculatePnl(dto);
    const riskReward = this.calculateRiskReward(dto);
    return this.prisma.trade.create({
      data: {
        ...dto,
        pnl: dto.pnl ?? pnl,
        riskReward: dto.riskReward ?? riskReward,
        userId,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : new Date(),
      },
    });
  }

  async findAll(userId: string, filters: TradeFiltersDto) {
    const { cursor, limit = 20, side, setup, emotion, dateFrom, dateTo } = filters;
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
    await this.findOne(userId, id);
    return this.prisma.trade.update({
      where: { id },
      data: {
        ...dto,
        tradedAt: dto.tradedAt ? new Date(dto.tradedAt) : undefined,
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.trade.delete({ where: { id } });
  }

  async checkMonthlyLimit(userId: string, plan: Plan): Promise<void> {
    if (plan !== Plan.FREE) return;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const count = await this.prisma.trade.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    });

    if (count >= 50) {
      throw new HttpException(
        { code: 'FREE_LIMIT_REACHED', message: 'Limite de 50 trades/mois atteinte' },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private calculatePnl(dto: CreateTradeDto): number | undefined {
    if (dto.entry && dto.exit) {
      const diff = dto.exit - dto.entry;
      return dto.side === 'LONG' ? diff : -diff;
    }
    return undefined;
  }

  private calculateRiskReward(dto: CreateTradeDto): number | undefined {
    if (dto.entry && dto.exit && dto.stopLoss) {
      const profit = Math.abs(dto.exit - dto.entry);
      const risk = Math.abs(dto.entry - dto.stopLoss);
      return risk > 0 ? profit / risk : undefined;
    }
    return undefined;
  }
}
