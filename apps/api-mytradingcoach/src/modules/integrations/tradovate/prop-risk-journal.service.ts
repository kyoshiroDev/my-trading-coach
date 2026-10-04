import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';

/** Ce qu'une séance retient d'un relevé (marges du moment, plancher). */
export interface RiskReading {
  drawdownMargin: number | null;
  dailyLossRemaining: number | null;
  floor: number | null;
}

/** Journée `AAAA-MM-JJ` → colonne `@db.Date`. */
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Journal de risque des séances prop firm (PREMIUM, #373) : ce que l'IA du récap et du Weekly
 * Debrief ne peut pas reconstituer depuis les trades clôturés — la marge la plus basse touchée
 * (et quand), le plancher en début et en fin de séance, les alertes et épisodes de tilt envoyés.
 * Best-effort : appelé par les alertes, un échec y est journalisé sans rien bloquer.
 */
@Injectable()
export class PropRiskJournalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garde le PLUS BAS de chaque marge de la journée ; plancher de début figé, de fin à jour. */
  async recordReading(accountId: string, day: string, r: RiskReading, now = new Date()): Promise<void> {
    if (r.drawdownMargin == null && r.dailyLossRemaining == null) return;
    const tradeDate = asDate(day);
    const prev = await this.prisma.accountRiskDay.findUnique({
      where: { accountId_tradeDate: { accountId, tradeDate } },
    });
    const lower = (value: number | null, known: number | null | undefined) =>
      value != null && (known == null || value < known);
    const dd = lower(r.drawdownMargin, prev?.minDrawdownMargin);
    const dl = lower(r.dailyLossRemaining, prev?.minDailyLossRemaining);
    const data = {
      ...(dd ? { minDrawdownMargin: r.drawdownMargin, minDrawdownAt: now } : {}),
      ...(dl ? { minDailyLossRemaining: r.dailyLossRemaining, minDailyLossAt: now } : {}),
      ...(r.floor != null ? { floorEnd: r.floor } : {}),
    };
    await this.prisma.accountRiskDay.upsert({
      where: { accountId_tradeDate: { accountId, tradeDate } },
      create: { accountId, tradeDate, floorStart: r.floor, ...data },
      update: { ...data, ...(prev?.floorStart == null && r.floor != null ? { floorStart: r.floor } : {}) },
    });
  }

  async recordEvent(
    userId: string,
    accountId: string,
    day: string,
    kind: string,
    level: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.propRiskEvent.create({
      data: { userId, accountId, tradeDate: asDate(day), kind, level, data: data as Prisma.InputJsonObject },
    });
  }
}
