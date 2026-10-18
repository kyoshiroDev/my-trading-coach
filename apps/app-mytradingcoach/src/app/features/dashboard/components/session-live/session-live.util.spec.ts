import { describe, it, expect } from 'vitest';
import type { EcoEvent } from '@mtc/shared';
import type { InstrumentDto } from '@app/core/api/trades.api';
import {
  bannerTickers, bySurprise, surprise, cmeClosed, cmeReopenLabel, moodLabel, planKindShort, RELEASE_DISPLAY_MS, releaseExpired, splitFirstSentence, closeKind, countdownLabel, nextAnnouncement, pointValue, positionBar, priceFromLatent,
} from './session-live.util';

// Extrait de instruments.const.ts (API) : valeur du point = tickValue / tickSize.
const INSTRUMENTS: InstrumentDto[] = [
  { symbol: 'MNQ', label: 'MNQ', category: 'FUTURES_US', tickValue: 0.5, tickSize: 0.25 },
  { symbol: 'NQ', label: 'NQ', category: 'FUTURES_US', tickValue: 5, tickSize: 0.25 },
  { symbol: 'MES', label: 'MES', category: 'FUTURES_US', tickValue: 1.25, tickSize: 0.25 },
  { symbol: 'ES', label: 'ES', category: 'FUTURES_US', tickValue: 12.5, tickSize: 0.25 },
];

describe('pointValue', () => {
  it.each([['MNQ', 2], ['NQ', 20], ['ES', 50], ['MES', 5]])('%s → %d $/pt', (asset, pv) => {
    expect(pointValue(asset, INSTRUMENTS)).toBe(pv);
  });
  it('actif inconnu → null', () => expect(pointValue('XYZ', INSTRUMENTS)).toBeNull());
});

describe('positionBar (#598)', () => {
  it('LONG MNQ avec SL et TP : barre complète, montants et R/R (maquette)', () => {
    const bar = positionBar({ side: 'LONG', entry: 18540, stop: 18500, target: 18620, current: 18520, quantity: 2, pv: 2 });
    expect(bar).toMatchObject({
      mode: 'full', stopPct: 0, targetPct: 100, entryPct: 33.3, currentPct: 16.7, inGain: false,
      stopAmount: -160, targetAmount: 320, rr: 2, stopPts: 40,
    });
  });

  it.each([
    ['NQ', 20, -400, 800],
    ['ES', 50, -1000, 2000],
    ['MES', 5, -100, 200],
  ])('%s, 1 contrat, stop 20 pts / TP 40 pts', (_asset, pv, sl, tp) => {
    const bar = positionBar({ side: 'LONG', entry: 100, stop: 80, target: 140, current: null, quantity: 1, pv });
    expect([bar.stopAmount, bar.targetAmount, bar.rr]).toEqual([sl, tp, 2]);
  });

  it('SHORT : l’axe va toujours du stop (gauche) au TP (droite)', () => {
    const bar = positionBar({ side: 'SHORT', entry: 5905, stop: 5915, target: 5885, current: 5900, quantity: 1, pv: 50 });
    expect(bar).toMatchObject({ mode: 'full', entryPct: 33.3, currentPct: 50, inGain: true, stopAmount: -500, targetAmount: 1000 });
  });

  it('sans SL ni TP : repli, aucune borne ni montant inventés', () => {
    const bar = positionBar({ side: 'LONG', entry: 18540, stop: null, target: null, current: 18520, quantity: 2, pv: 2 });
    expect(bar).toEqual({
      mode: 'fallback', entryPct: 50, stopPct: null, targetPct: null, currentPct: 0, inGain: false,
      stopAmount: null, targetAmount: null, rr: null, stopPts: null,
    });
  });

  it('sans SL, TP connu : seul ce côté', () => {
    const bar = positionBar({ side: 'LONG', entry: 100, stop: null, target: 120, current: 110, quantity: 1, pv: 2 });
    expect(bar).toMatchObject({ mode: 'target', stopPct: null, stopAmount: null, rr: null, targetAmount: 40, currentPct: 50 });
  });

  it('SL du mauvais côté de l’entrée : ignoré (ce n’est pas une protection)', () => {
    expect(positionBar({ side: 'LONG', entry: 100, stop: 110, target: null, current: null, quantity: 1, pv: 2 }).mode).toBe('fallback');
  });

  it('prix inconnu : pas de pastille', () => {
    expect(positionBar({ side: 'LONG', entry: 100, stop: 90, target: 120, current: null, quantity: 1, pv: 2 }).currentPct).toBeNull();
  });
});

describe('priceFromLatent', () => {
  it('LONG MNQ 2 contrats, latent -80 $ → 20 pts sous l’entrée', () => {
    expect(priceFromLatent('LONG', 18540, 2, -80, 2)).toBe(18520);
  });
  it('SHORT : latent positif = prix sous l’entrée', () => {
    expect(priceFromLatent('SHORT', 5905, 1, 250, 50)).toBe(5900);
  });
  it('latent ou valeur du point inconnus → null', () => {
    expect(priceFromLatent('LONG', 18540, 2, null, 2)).toBeNull();
    expect(priceFromLatent('LONG', 18540, 2, -80, null)).toBeNull();
  });
});

describe('nextAnnouncement (#593)', () => {
  const ev = (time: string, isReleased = false, name = 'PMI'): EcoEvent => ({
    time, name, impact: 'high', country: 'US', currency: 'USD', actual: null, estimate: null, previous: null, isReleased,
  });
  const now = new Date(2026, 9, 17, 10, 12);

  it('la plus proche non publiée, compte à rebours en minutes', () => {
    expect(nextAnnouncement([ev('14:30'), ev('10:30', false, 'PMI UK'), ev('09:00')], now))
      .toMatchObject({ event: { name: 'PMI UK' }, minutes: 18 });
  });

  it('plusieurs annonces à la même heure : un seul créneau, impact fort en tête et couleur de la ligne', () => {
    const medium = { ...ev('14:30', false, 'Jobless Claims'), impact: 'medium' as const };
    const n = nextAnnouncement([medium, ev('14:30', false, 'Retail Sales MoM'), ev('16:00', false, 'ISM')], now)!;
    expect(n.events.map((e) => e.name)).toEqual(['Retail Sales MoM', 'Jobless Claims']);
    expect(n.event.name).toBe('Retail Sales MoM');
    expect(n.impact).toBe('high');
    expect(nextAnnouncement([medium], now)!.impact).toBe('medium');
  });

  it('aucune annonce restante aujourd’hui → null (ligne absente)', () => {
    expect(nextAnnouncement([ev('09:00'), ev('11:00', true)], now)).toBeNull();
    expect(nextAnnouncement([], now)).toBeNull();
  });

  it('libellés', () => {
    expect(countdownLabel(18)).toBe('dans 18 min');
    expect(countdownLabel(65)).toBe('dans 1 h 05');
    expect(countdownLabel(0)).toBe('maintenant');
  });
});

describe('closeKind', () => {
  it('TP, SL, Manuel', () => {
    expect(closeKind({ side: 'LONG', exit: 110, stopLoss: 90, takeProfit: 110 })).toBe('TP');
    expect(closeKind({ side: 'SHORT', exit: 5908, stopLoss: 5908, takeProfit: 5890 })).toBe('SL');
    expect(closeKind({ side: 'LONG', exit: 100, stopLoss: null, takeProfit: null })).toBe('Manuel');
  });
});

describe('annonce publiée (#593)', () => {
  it('reste affichée 15 min au plus', () => {
    expect(releaseExpired(0, RELEASE_DISPLAY_MS - 1)).toBe(false);
    expect(releaseExpired(0, RELEASE_DISPLAY_MS)).toBe(true);
  });

  it('première phrase de l’analyse, le reste dépliable', () => {
    expect(splitFirstSentence('Inflation au-dessus du consensus. Pression sur le Nasdaq. Dollar soutenu.'))
      .toEqual({ first: 'Inflation au-dessus du consensus.', rest: 'Pression sur le Nasdaq. Dollar soutenu.' });
    expect(splitFirstSentence('Une seule phrase')).toEqual({ first: 'Une seule phrase', rest: '' });
  });
});

describe('bandeau PC (#597)', () => {
  it('NQ, SPX, DXY, 10Y avec variation ; valeurs absentes → « - »', () => {
    const t = bannerTickers({
      nq: { value: 18584.3, changePct: 0.62, source: 'x' }, spx: { value: 5912, changePct: -0.41, source: 'x' },
      dxy: { value: 104.2, changePct: null, source: 'x' },
      treasury: { t2y: null, t2yChg: null, t5y: null, t5yChg: null, t10y: 4.31, t10yChg: null, t30y: null, t30yChg: null },
      updatedAt: '',
    });
    expect(t.map((x) => x.label)).toEqual(['NQ', 'SPX', 'DXY', '10Y']);
    expect(t[0]).toMatchObject({ change: '+0,62 %', dir: 'up' });
    expect(t[1]).toMatchObject({ change: '-0,41 %', dir: 'down' });
    expect(t[2]).toMatchObject({ value: '104,20', change: null, dir: 'flat' });
    expect(t[3].value).toBe('4,31 %');
    expect(bannerTickers(null)).toEqual([]);
  });

  it('bandeau défilant : taux 2 ans et 30 ans en plus', () => {
    const t = bannerTickers({
      nq: { value: 1, changePct: 0, source: 'x' }, spx: { value: 1, changePct: 0, source: 'x' }, dxy: { value: 1, changePct: 0, source: 'x' },
      treasury: { t2y: 3.9, t2yChg: null, t5y: null, t5yChg: null, t10y: 4.31, t10yChg: null, t30y: null, t30yChg: null },
      updatedAt: '',
    }, true);
    expect(t.map((x) => `${x.label} ${x.value}`)).toEqual(['NQ 1', 'SPX 1', 'DXY 1,00', '2Y 3,90 %', '10Y 4,31 %', '30Y -']);
  });

  it('humeur en texte seul, type de plan court', () => {
    expect(moodLabel('FOCUSED')).toBe('Concentré');
    expect(moodLabel(null)).toBeNull();
    expect(planKindShort('trailing_eod')).toBe('EOD');
    expect(planKindShort(null)).toBeNull();
  });
});

describe('marché CME fermé (vitrine démo le week-end)', () => {
  it('fermé du vendredi 16:00 au dimanche 17:00, heure de Chicago', () => {
    expect(cmeClosed(new Date('2026-10-16T20:59:00Z'))).toBe(false); // ven. 15:59 CDT
    expect(cmeClosed(new Date('2026-10-16T21:00:00Z'))).toBe(true);  // ven. 16:00 CDT
    expect(cmeClosed(new Date('2026-10-18T12:00:00Z'))).toBe(true);  // dimanche
    expect(cmeClosed(new Date('2026-10-18T22:00:00Z'))).toBe(false); // dim. 17:00 CDT
    expect(cmeClosed(new Date('2026-10-19T09:00:00Z'))).toBe(false); // lundi
  });

  it('heure de réouverture en clair, rien si le marché est ouvert', () => {
    expect(cmeReopenLabel(new Date('2026-10-18T12:00:00Z'))).toMatch(/^(dimanche|lundi) \d{2}:\d{2}$/);
    expect(cmeReopenLabel(new Date('2026-10-19T09:00:00Z'))).toBeNull();
  });
});

describe('plusieurs annonces fortes publiées ensemble', () => {
  it('surprise = écart publié / prévu rapporté à la prévision ; inconnue sans prévision', () => {
    expect(surprise({ actual: 254, estimate: 150 })).toBeCloseTo(0.693, 3);
    expect(surprise({ actual: 4.1, estimate: 4.2 })).toBeCloseTo(0.024, 3);
    expect(surprise({ actual: 4.1, estimate: null })).toBeNull();
  });

  it('onglet ouvert en premier : la plus surprenante', () => {
    const nfp = { name: 'NFP', actual: 254, estimate: 150 };
    const unemp = { name: 'Chômage', actual: 4.1, estimate: 4.2 };
    const noEst = { name: 'X', actual: 1, estimate: null };
    expect(bySurprise([unemp, noEst, nfp]).map((e) => e.name)).toEqual(['NFP', 'Chômage', 'X']);
  });
});
