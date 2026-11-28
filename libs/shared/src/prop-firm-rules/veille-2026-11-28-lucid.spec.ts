import { describe, expect, it } from 'vitest';
import lucid from './lucid.json';

/*
 * Veille du 2026-11-28 (#858) : Lucid relu en entier (configurateur de lucidtrading.com dans Chrome,
 * 31 articles du centre d'aide). Prix catalogue avant coupon, buffer LucidPro après le payout, payouts
 * à la demande liés au DLL. À réécrire si une veille suivante change ces plans.
 */

interface Plan {
  id: string;
  configuration: { daily_loss_limit?: boolean } | null;
  availability: string;
  price: { amount: number | null; notes: string | null };
  phases: { phase: string; payout: { safety_net_balance: number | null; safety_net_basis?: string; min_amount: number | null } | null }[];
  notes: string | null;
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}
const firm = lucid as unknown as Firm;
const get = (id: string): Plan => {
  const plan = firm.plans.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};

const PRICES: Record<string, [number, number, number, number]> = {
  'lucid-pro': [137, 223, 322, 429],
  'lucid-pro-dll': [116, 180, 272, 365],
  'lucid-flex': [97, 177, 279, 379],
  'lucid-flex-dll': [76, 127, 215, 323],
  'lucid-flex-c50': [111, 198, 308, 422],
  'lucid-flex-dll-c50': [83, 138, 243, 358],
  'lucid-daily-eod': [115, 165, 258, 358],
  'lucid-daily-intraday': [93, 129, 215, 300],
  'lucid-daily-dll-eod': [86, 122, 200, 286],
  'lucid-daily-dll-intraday': [72, 94, 158, 229],
  'lucid-daily-c50-eod': [129, 186, 286, 400],
  'lucid-daily-c50-intraday': [108, 143, 243, 336],
  'lucid-daily-dll-c50-eod': [93, 136, 222, 315],
  'lucid-daily-dll-c50-intraday': [79, 108, 179, 258],
  'lucid-daily-eod-funded-eod': [229, 336, 500, 700],
  'lucid-daily-c30-eod-funded-eod': [179, 265, 400, 558],
  'lucid-direct': [329, 515, 700, 836],
};
const SIZES = ['25k', '50k', '100k', '150k'] as const;

describe('veille du 2026-11-28 : Lucid (#858)', () => {
  it('relu en entier : date du jour', () => {
    expect(firm.verified_at).toBe('2026-11-28');
  });

  it.each(Object.entries(PRICES))('%s : prix catalogue 25K / 50K / 100K / 150K', (base, prices) => {
    SIZES.forEach((size, i) => expect(get(`${base}-${size}`).price.amount).toBe(prices[i]));
  });

  it('toutes les configurations publiques ont un prix ; LucidMaxx (sur invitation) garde le sien', () => {
    const publics = firm.plans.filter((p) => p.availability === 'public');
    expect(publics).toHaveLength(68);
    expect(publics.filter((p) => p.price.amount == null)).toEqual([]);
    expect(SIZES.map((s) => get(`lucid-maxx-${s}`).price.amount)).toEqual([185, 300, 450, 675]);
  });

  it('LucidPro : buffer à garder après le payout (sorti de la liste #1320), minimum 500 $', () => {
    const pro = firm.plans.filter((p) => p.id.startsWith('lucid-pro-'));
    expect(pro).toHaveLength(8);
    for (const p of pro) {
      const funded = p.phases.find((ph) => ph.phase === 'funded')!;
      expect(funded.payout).toMatchObject({ safety_net_basis: 'after_payout', min_amount: 500 });
    }
  });

  it('plus aucune note « non relevé » sur un plan qui a son prix', () => {
    for (const p of firm.plans.filter((x) => x.price.amount != null)) expect(p.notes ?? '').not.toMatch(/non relevé/);
  });

  it('payouts à la demande liés au DLL (Pro, Flex, Daily)', () => {
    for (const p of firm.plans.filter((x) => /^lucid-(pro|flex|daily)-/.test(x.id))) {
      const dll = !!p.configuration?.daily_loss_limit;
      expect(p.notes).toContain(dll ? 'Payouts à la demande (en séance) : actifs avec le DLL' : 'Sans DLL : pas de payout à la demande');
    }
  });
});
