import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { todayParis } from '@mtc/shared';
import type { ProductEvent } from './product-events.const';

@Injectable()
export class ProductEventsService {
  private readonly logger = new Logger(ProductEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compte un événement (jour Paris × user × événement × écran). `INSERT … ON CONFLICT` :
   * atomique, sans course. Best-effort : une erreur ne remonte jamais à l'utilisateur.
   */
  async record(userId: string, event: ProductEvent, place = ''): Promise<void> {
    const date = new Date(`${todayParis()}T00:00:00Z`);
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "ProductEventDaily" ("id", "date", "userId", "event", "place", "count")
        VALUES (gen_random_uuid()::text, ${date}::date, ${userId}, ${event}, ${place}, 1)
        ON CONFLICT ("date", "userId", "event", "place")
        DO UPDATE SET "count" = "ProductEventDaily"."count" + 1
      `;
    } catch (err) {
      this.logger.warn(`Événement produit non enregistré (${event}) : ${(err as Error).message}`);
    }
  }
}
