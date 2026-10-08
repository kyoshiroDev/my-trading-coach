import { describe, it, expect, vi } from 'vitest';
import { offerDigestLines } from './offer-digest.util';

function prisma(o: { open?: boolean; taken?: number; active?: number; before?: number; codes?: object[]; used?: object[] }) {
  return {
    founderOfferConfig: { findUnique: vi.fn().mockResolvedValue({ open: o.open ?? false }) },
    founderSeat: {
      count: vi.fn().mockImplementation(({ where }) => {
        if (where.takenAt) return Promise.resolve(o.before ?? 0);
        if (where.status === 'ACTIVE') return Promise.resolve(o.active ?? 0);
        return Promise.resolve(o.taken ?? 0);
      }),
    },
    partnerCode: { findMany: vi.fn().mockResolvedValue(o.codes ?? []) },
    partnerRedemption: { groupBy: vi.fn().mockResolvedValue(o.used ?? []) },
  } as never;
}
const since = new Date('2026-10-20T06:00:00Z');

describe('offerDigestLines — ligne « offres » du digest (#525)', () => {
  it('offre jamais ouverte, aucun code → rien', async () => {
    expect(await offerDigestLines(prisma({}), since)).toEqual([]);
  });

  it('fondateurs et codes partenaires sur une ligne', async () => {
    const lines = await offerDigestLines(prisma({
      open: true, taken: 37, active: 35, before: 37,
      codes: [{ id: 'a', code: 'LOUIS29', maxRedemptions: 10, active: true }, { id: 'b', code: 'TRIO', maxRedemptions: null, active: false }],
      used: [{ partnerCodeId: 'a', _count: { _all: 4 } }],
    }), since);
    expect(lines).toEqual(['Fondateurs : 37 / 200 (35 actifs) · Codes partenaires : LOUIS29 4/10, TRIO 0/illimité (inactif)']);
  });

  it('palier franchi sur la période → ligne dédiée', async () => {
    const lines = await offerDigestLines(prisma({ open: true, taken: 52, active: 52, before: 48 }), since);
    expect(lines).toContain('Palier atteint : 50 places');
  });

  it('offre refermée avec des fondateurs → « offre fermée »', async () => {
    const lines = await offerDigestLines(prisma({ open: false, taken: 200, active: 190, before: 200 }), since);
    expect(lines[0]).toBe('Fondateurs : 200 / 200 (190 actifs) · offre fermée');
  });
});
