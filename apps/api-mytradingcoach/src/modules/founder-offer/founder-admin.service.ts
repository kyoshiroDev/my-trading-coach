import { Injectable } from '@nestjs/common';
import { FounderSeatStatus } from '@prisma/client';
import { FOUNDER_OFFER } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { FounderOfferService } from './founder-offer.service';

const PAGE_SIZE = 50;

/** Vue admin des fondateurs : liste paginée et totaux. */
@Injectable()
export class FounderAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly founders: FounderOfferService,
  ) {}

  async list(args: { status?: FounderSeatStatus; page: number }) {
    const where = args.status ? { status: args.status } : {};
    const [rows, filtered, byStatus, byCta, config, seatsLeft] = await Promise.all([
      this.prisma.founderSeat.findMany({
        where,
        orderBy: { number: 'asc' },
        skip: (args.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: {
            select: {
              id: true, email: true, acquisitionSource: true, acquisitionMedium: true, acquisitionCampaign: true,
            },
          },
        },
      }),
      this.prisma.founderSeat.count({ where }),
      this.prisma.founderSeat.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.founderSeat.groupBy({
        by: ['cta'],
        where: { status: { in: [FounderSeatStatus.ACTIVE, FounderSeatStatus.LOST] } },
        _count: { _all: true },
      }),
      this.founders.getConfig(),
      this.founders.seatsLeft(),
    ]);
    const count = (s: FounderSeatStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const active = count(FounderSeatStatus.ACTIVE);
    const lost = count(FounderSeatStatus.LOST);
    return {
      offer: { open: config.open, endsAt: config.endsAt, seatsTotal: FOUNDER_OFFER.seats },
      totals: {
        taken: active + lost,
        active,
        lost,
        refunded: count(FounderSeatStatus.REFUNDED),
        released: count(FounderSeatStatus.RELEASED),
        seatsLeft,
        byCta: byCta.map((r) => ({ cta: r.cta, count: r._count._all })),
      },
      page: args.page,
      pageSize: PAGE_SIZE,
      total: filtered,
      rows: rows.map((r) => ({
        number: r.number,
        status: r.status,
        interval: r.interval,
        cta: r.cta,
        takenAt: r.takenAt,
        endedAt: r.endedAt,
        userId: r.user?.id ?? null,
        email: r.user?.email ?? null,
        source: r.user?.acquisitionSource ?? null,
        medium: r.user?.acquisitionMedium ?? null,
        campaign: r.user?.acquisitionCampaign ?? null,
      })),
    };
  }
}
