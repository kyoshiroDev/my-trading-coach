import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { seedDemo, DemoSeedResult } from './demo-seed';

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Seed/refresh idempotent du compte démo (déclenchable par un admin). */
  async run(): Promise<DemoSeedResult> {
    const res = await seedDemo(this.prisma);
    this.logger.log(
      `Compte démo seedé : ${res.trades} trades · WR ${res.winRate}% · P&L +$${res.pnl}`,
    );
    return res;
  }
}
