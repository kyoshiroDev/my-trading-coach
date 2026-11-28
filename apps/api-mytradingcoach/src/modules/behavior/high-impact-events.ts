import type { PrismaService } from '../../prisma/prisma.service';
import { parisDate, parisWallTimeToUtc } from '../eco-calendar/eco-calendar.schedule';
import { type NewsEvent, newsLabel } from './behavior-news';

/**
 * Annonces à fort impact entre deux instants (jours de Paris inclus), heure convertie en UTC. Source unique
 * de la stat « Tes trades autour des annonces » (#670) et de la règle des annonces du contrat de session (#667).
 */
export async function highImpactEventsBetween(prisma: PrismaService, from: Date, to: Date): Promise<NewsEvent[]> {
  const rows = await prisma.ecoEvent.findMany({
    where: { impact: 'high', date: { gte: parisDate(from), lte: parisDate(to) } },
    select: { date: true, time: true, name: true, nameFr: true, currency: true },
  });
  return rows
    .map((r) => ({ at: parisWallTimeToUtc(r.date, r.time), label: newsLabel(r), currency: r.currency }))
    .filter((e): e is NewsEvent => e.at !== null);
}
