import { FOUNDER_MILESTONES, FOUNDER_OFFER } from '@mtc/shared';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Ligne « offres » du digest quotidien (#525) :
 * « Fondateurs : 37 / 200 (35 actifs) · Codes partenaires : LOUIS29 4/10, TRIO 2/illimité »,
 * plus « Palier atteint : 50 places » si un palier a été franchi sur la période.
 * Rien tant que l'offre n'a jamais ouvert et qu'aucun code n'existe. Le compte démo n'est jamais
 * fondateur ni partenaire (exclu à l'éligibilité) : aucun filtre `isDemo` à ajouter ici.
 */
export async function offerDigestLines(prisma: PrismaService, since: Date): Promise<string[]> {
  const TAKEN = { in: ['ACTIVE', 'LOST'] as ('ACTIVE' | 'LOST')[] };
  const [config, taken, active, takenBefore, codes, used] = await Promise.all([
    prisma.founderOfferConfig.findUnique({ where: { id: 1 } }),
    prisma.founderSeat.count({ where: { status: TAKEN } }),
    prisma.founderSeat.count({ where: { status: 'ACTIVE' } }),
    prisma.founderSeat.count({ where: { status: TAKEN, takenAt: { lt: since } } }),
    prisma.partnerCode.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, code: true, maxRedemptions: true, active: true } }),
    prisma.partnerRedemption.groupBy({ by: ['partnerCodeId'], where: { status: TAKEN }, _count: { _all: true } }),
  ]);

  const parts: string[] = [];
  if (config?.open || taken > 0) {
    parts.push(`Fondateurs : ${taken} / ${FOUNDER_OFFER.seats} (${active} actif${active > 1 ? 's' : ''})${config?.open ? '' : ' · offre fermée'}`);
  }
  if (codes.length) {
    const list = codes.map((c) => {
      const n = used.find((u) => u.partnerCodeId === c.id)?._count._all ?? 0;
      return `${c.code} ${n}/${c.maxRedemptions ?? 'illimité'}${c.active ? '' : ' (inactif)'}`;
    });
    parts.push(`Codes partenaires : ${list.join(', ')}`);
  }
  const lines = parts.length ? [parts.join(' · ')] : [];
  const crossed = FOUNDER_MILESTONES.filter((m) => takenBefore < m && taken >= m);
  if (crossed.length) lines.push(`Palier atteint : ${crossed.join(', ')} places`);
  return lines;
}
