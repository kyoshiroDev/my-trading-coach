import { describe, expect, it } from 'vitest';
import blusky from './blusky.json';
import fff from './fundedfuturesfamily.json';
import topstep from './topstep.json';
import tradeday from './tradeday.json';
import uprofit from './uprofit.json';

/* Veille du 2026-11-28, lot 6c (#1344, #653) : FFF devenue Funded Family One (prix de l'accueil), notes BluSky et Topstep, relecture TradeDay et UProfit. À réécrire si une veille suivante change ces plans. */

interface Plan {
  id: string;
  account_size: number;
  notes: string | null;
  price: { amount: number | null; billing: string; notes: string | null };
}
interface Firm {
  firm: { id: string; name: string; website: string; help_center: string | null };
  verified_at: string;
  plans: Plan[];
}
const get = (firm: Firm, id: string): Plan => {
  const plan = firm.plans.find((p) => p.id === id);
  if (!plan) throw new Error(`plan absent : ${id}`);
  return plan;
};

describe('veille du 2026-11-28, lot 6c', () => {
  it('cinq firms relues : date de la relecture', () => {
    for (const firm of [fff, blusky, topstep, tradeday, uprofit] as Firm[]) expect(firm.verified_at).toBe('2026-11-28');
  });

  it('FFF renommée « Funded Family One » (même société), id et centre d’aide inchangés : slug et liaisons stables', () => {
    expect((fff as Firm).firm).toMatchObject({
      id: 'fundedfuturesfamily',
      name: 'Funded Family One',
      website: 'https://fundedfamilyone.com',
      help_center: 'https://intercom.help/funded-futures-family/en/',
    });
  });

  it.each([
    ['velocity', [179, 265, 475, 675]],
    ['prime', [144, 204, 319, 425]],
    ['premier-eod', [136.5, 181.5, 278.5, 499]],
    ['premier-intraday', [136.5, 181.5, 278.5, 499]],
  ] as const)('FFF %s : prix réguliers de l’accueil, mensuels', (kind, prices) => {
    ['25k', '50k', '100k', '150k'].forEach((size, i) => {
      expect(get(fff as Firm, `fundedfuturesfamily-${kind}-${size}`).price).toMatchObject({ amount: prices[i], billing: 'monthly' });
    });
  });

  it('FFF : option Max sans prix séparé (non deviné), Payday 699,99 $ unique, S2F du 20/11 inchangé', () => {
    for (const size of ['25k', '50k', '100k', '150k']) expect(get(fff as Firm, `fundedfuturesfamily-prime-max-${size}`).price.amount).toBeNull();
    expect(get(fff as Firm, 'fundedfuturesfamily-payday-50k').price).toMatchObject({ amount: 699.99, billing: 'one_time' });
    expect(get(fff as Firm, 'fundedfuturesfamily-s2f-nov20-50k').price.amount).toBe(489);
  });

  it.each([['50k', 599], ['100k', 699], ['150k', 829]] as const)('Topstep %s : Back2Funded dans les notes de prix des plans classiques', (size, amount) => {
    for (const kind of ['standard', 'standard-dll', 'consistency', 'consistency-dll']) {
      expect(get(topstep as Firm, `topstep-${kind}-${size}`).price.notes).toContain(`Back2Funded`);
      expect(get(topstep as Firm, `topstep-${kind}-${size}`).price.notes).toContain(`${amount} $`);
    }
  });

  it('BluSky : le profit au-delà de l’objectif de la Buffer Zone n’est pas transféré', () => {
    const plans = (blusky as Firm).plans;
    const withBuffer = plans.filter((p) => /^blusky-(launch|propel)-/.test(p.id));
    expect(withBuffer.length).toBeGreaterThan(0);
    for (const plan of withBuffer) expect(plan.notes).toContain('Excess earnings will not be transferred');
    // Orbit n'a pas de Buffer Zone : la précision ne le concerne pas.
    const orbit = plans.filter((p) => p.id.startsWith('blusky-orbit-'));
    expect(orbit.length).toBeGreaterThan(0);
    for (const plan of orbit) expect(JSON.stringify(plan)).not.toContain('Excess earnings');
  });
});
