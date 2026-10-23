import { describe, expect, it } from 'vitest';
import { aiParagraphs, autopsyKpis, autopsyRows, crossedAt, distanceChart, headline } from './autopsy.util';
import { alreadyCrossedReport, mockupReport, parisAt as at } from './autopsy.fixture';

describe('autopsy.util — en-tête et KPI de la maquette', () => {
  it('phrase sous le titre : franchissement daté, nombre de trades, estimation', () => {
    const r = mockupReport();
    expect(crossedAt(r)).toBe(at('11:12'));
    expect(headline(r)).toBe(
      "Plancher estimé franchi le 14 oct. à 11:12 · séance de 5 trades · estimation MyTradingCoach d'après tes trades enregistrés, pas le calcul officiel de ta firm.",
    );
  });

  it('perte du jour et échec marqué à la main : formulations dédiées', () => {
    expect(headline(mockupReport({ kind: 'daily_loss' }))).toMatch(/^Perte du jour estimée atteinte le 14 oct\. à 11:12/);
    expect(headline(mockupReport({ kind: 'manual', series: [] }))).toMatch(/^Compte marqué comme échoué · dernière séance du 14 oct\./);
  });

  it('séance, taille max (contre la taille de départ), marge au départ', () => {
    expect(autopsyKpis(mockupReport())).toEqual([
      { label: 'SÉANCE', value: '-$1,050', sub: '5 trades', tone: 'neg' },
      { label: 'TAILLE MAX', value: '4 MNQ', sub: 'contre 2 au début', tone: null },
      { label: 'MARGE AU DÉPART', value: '$1,000', sub: 'avant 09:34', tone: null },
    ]);
  });

  it('sans relevé : rien d’inventé', () => {
    const k = autopsyKpis(mockupReport({ kpis: { net: -10, trades: 1, maxQuantity: null, firstQuantity: null, startDistance: null } }));
    expect(k[1]).toMatchObject({ value: '-', sub: 'taille constante' });
    expect(k[2]).toMatchObject({ value: '-', sub: 'non relevée' });
  });
});

describe('autopsy.util — chronologie', () => {
  it('lignes de la maquette : trade, alerte, « après l’alerte », trade du franchissement', () => {
    const rows = autopsyRows(mockupReport());
    expect(rows[0]).toMatchObject({ time: '09:34', title: 'LONG MNQ · 2 contrats', pnl: '+$80', tone: 'pos', meta: 'Distance à la limite : $1,080' });
    expect(rows[3]).toMatchObject({
      time: '10:44', title: "Alerte : pertes d'affilée", alert: true,
      meta: 'Enregistrée par MyTradingCoach, trade suivant 5 min plus tard',
    });
    expect(rows.filter((r) => r.afterAlert).map((r) => r.key)).toEqual(['t4', 't5']);
    expect(rows.filter((r) => r.crossing).map((r) => r.key)).toEqual(['t5']);
    expect(rows[5].meta).toBe('Distance à la limite : -$50');
  });
});

describe('autopsy.util — courbe de distance', () => {
  it('un point par trade, limite à 0, alerte entre 10:21 et 10:49, dernier point marqué', () => {
    const c = distanceChart(mockupReport(), 358)!;
    expect(c.points).toHaveLength(6);
    expect(c.points.at(-1)!.last).toBe(true);
    expect(c.points[5].y).toBeGreaterThan(c.zeroY);
    expect(c.points[4].y).toBeLessThan(c.zeroY);
    expect(c.alerts).toHaveLength(1);
    expect(c.alerts[0].label).toBe('Alerte 10:44');
    expect(c.alerts[0].x).toBeGreaterThan(c.points[3].x);
    expect(c.alerts[0].x).toBeLessThan(c.points[4].x);
    expect([c.startLabel, c.endLabel]).toEqual(['09:34', '11:12']);
    expect(c.aria).toBe('Distance à la limite au fil de la séance : de $1,000 à -$50');
  });

  it('moins de deux points : pas de courbe', () => {
    expect(distanceChart(mockupReport({ series: [] }), 358)).toBeNull();
  });
});

describe('autopsy.util — analyse IA', () => {
  it('paragraphes séparés par une ligne vide', () => {
    expect(aiParagraphs("D'après tes trades…\n\nL'alerte de 10:44…\n")).toEqual(["D'après tes trades…", "L'alerte de 10:44…"]);
  });

  it("espace insécable devant « : » (la ponctuation ne passe pas seule à la ligne), heures intactes", () => {
    expect(aiParagraphs('deux phases : trois trades à 10:44 ?')).toEqual(['deux phases\u00a0: trois trades à 10:44\u00a0?']);
  });
});

describe('autopsy.util — limite déjà franchie avant la séance (revue #712)', () => {
  it("en-tête sans franchissement daté, marge de départ signée", () => {
    const r = alreadyCrossedReport();
    expect(crossedAt(r)).toBeNull();
    expect(headline(r)).toMatch(/^Plancher estimé déjà franchi avant la séance du 20 août · séance de 1 trade/);
    expect(autopsyKpis(r)[2]).toMatchObject({ label: 'MARGE AU DÉPART', value: '-$98' });
  });
});
