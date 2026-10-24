import { describe, it, expect } from 'vitest';
import { alertLabel, buildIncidentReport, crossingPoint, distanceSeries, type IncidentReportInput, type IncidentTrade, type PreviousSession } from './incident-report';
import { INCIDENT_AI_MAX_TOKENS, INCIDENT_AI_SYSTEM, buildIncidentPrompt } from './incident-ai.prompt';

/**
 * Autopsie (#669) : la séance de la maquette (`maquettes/mockup-autopsie.html`), heures de Paris
 * (UTC+2 le 14 octobre 2026).
 */
const at = (hhmm: string) => new Date(`2026-10-14T${String(+hhmm.slice(0, 2) - 2).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`);
const trade = (id: string, hhmm: string, side: string, quantity: number, pnl: number): IncidentTrade => ({
  id, tradedAt: at(hhmm), asset: 'MNQ', side, quantity, pnl, commission: 0,
});

const MOCKUP_TRADES = [
  trade('t1', '09:34', 'LONG', 2, 80),
  trade('t2', '09:58', 'SHORT', 2, -140),
  trade('t3', '10:21', 'LONG', 2, -160),
  trade('t4', '10:49', 'LONG', 4, -420),
  trade('t5', '11:12', 'SHORT', 4, -410),
];

function input(over: Partial<IncidentReportInput> = {}): IncidentReportInput {
  return {
    kind: 'drawdown',
    currency: 'USD',
    snapshot: { limit: 2000, remaining: -50, detectedAt: at('11:13').toISOString() },
    // Ordre volontairement mélangé : le rapport trie lui-même.
    trades: [...MOCKUP_TRADES].reverse(),
    alerts: [{ at: at('10:44'), source: 'behavior', type: 'C1_LOSS_STREAK' }],
    previous: [],
    ...over,
  };
}

/** Texte attendu avec l'espace insécable devant `: ; ! ? %` (comme le rapport le produit). */
const nb = (text: string) => text.replace(/ ([:;!?%])/g, '\u00a0$1');

/** Pas de conseil, pas de promesse, pas de prédiction (AMF). */
const ADVICE = /devrais|aurais dû|conseil|achète|vends|garanti|promet|prévoi|il faut/i;

describe('buildIncidentReport — chronologie', () => {
  it('distance à la limite reconstruite trade par trade depuis la marge relevée', () => {
    const r = buildIncidentReport(input());
    expect(r.kpis).toEqual({ net: -1050, trades: 5, maxQuantity: 4, firstQuantity: 2, startDistance: 1000 });
    expect(r.series.map((p) => p.distance)).toEqual([1000, 1080, 940, 780, 360, -50]);
    expect(r.series[0].at).toBeNull();
  });

  it("intercale l'alerte, marque les trades pris après elle et le délai jusqu'au trade suivant", () => {
    const r = buildIncidentReport(input());
    expect(r.timeline.map((e) => (e.type === 'trade' ? e.tradeId : 'alerte'))).toEqual(['t1', 't2', 't3', 'alerte', 't4', 't5']);
    const alert = r.timeline[3];
    expect(alert).toMatchObject({ type: 'alert', label: "pertes d'affilée", nextTradeMinutes: 5 });
    const flags = r.timeline.filter((e) => e.type === 'trade').map((e) => e.type === 'trade' && e.afterAlert);
    expect(flags).toEqual([false, false, false, true, true]);
  });

  it('trade sorti APRÈS le relevé (position ouverte au franchissement) : ajouté à la suite, sans fausser le départ', () => {
    const r = buildIncidentReport(input({ snapshot: { limit: 2000, remaining: 360, detectedAt: at('10:50').toISOString() } }));
    expect(r.kpis.startDistance).toBe(1000);
    expect(r.series.at(-1)?.distance).toBe(-50);
  });

  it('sans relevé (échec marqué à la main) : aucune distance inventée', () => {
    const r = buildIncidentReport(input({ kind: 'manual', snapshot: null }));
    expect(r.kpis.startDistance).toBeNull();
    expect(r.series).toEqual([]);
    expect(r.timeline.every((e) => e.type === 'alert' || e.distanceAfter === null)).toBe(true);
  });

  it('frais déduits : la chronologie montre le net', () => {
    const r = buildIncidentReport(input({ trades: [{ ...MOCKUP_TRADES[0], commission: 4 }], snapshot: null }));
    expect(r.timeline[0]).toMatchObject({ type: 'trade', net: 76 });
  });
});

describe('alertLabel — alertes retenues', () => {
  it('ignore le franchissement lui-même, les bonnes nouvelles et les types inconnus', () => {
    expect(alertLabel({ at: at('11:12'), source: 'prop', type: 'drawdown', level: 'breached' })).toBeNull();
    expect(alertLabel({ at: at('11:12'), source: 'prop', type: 'objective', level: 'reached' })).toBeNull();
    expect(alertLabel({ at: at('11:12'), source: 'prop', type: 'consistency', level: 'warning' })).toBeNull();
    expect(alertLabel({ at: at('11:12'), source: 'behavior', type: 'Z_INCONNU' })).toBeNull();
  });

  it('garde les paliers de marge et le tilt', () => {
    expect(alertLabel({ at: at('10:00'), source: 'prop', type: 'drawdown', level: 'warning' })).toBe(nb('marge drawdown sous 25 %'));
    expect(alertLabel({ at: at('10:00'), source: 'prop', type: 'daily_loss', level: 'critical' })).toBe(nb('perte du jour sous 10 %'));
    expect(alertLabel({ at: at('10:00'), source: 'prop', type: 'tilt', level: 'revenge' })).toBe('reprise rapide après une perte');
  });

  it("une alerte non retenue ne marque aucun trade « après l'alerte »", () => {
    const r = buildIncidentReport(input({ alerts: [{ at: at('09:00'), source: 'prop', type: 'drawdown', level: 'breached' }] }));
    expect(r.timeline.some((e) => e.type === 'alert' || e.afterAlert)).toBe(false);
  });
});

describe('buildIncidentReport — 3 constats', () => {
  it('séance de la maquette : taille, concentration de la perte, trades après l’alerte', () => {
    const { findings } = buildIncidentReport(input());
    expect(findings).toHaveLength(3);
    expect(findings).toContain(nb("2 trades pris après l'alerte de 10:44 (pertes d'affilée), pour -$830."));
    expect(findings).toContain(nb('Taille : 2 contrats au premier trade, 4 contrats à partir du 4e, après 2 pertes d\'affilée.'));
    expect(findings).toContain('Les 2 derniers trades représentent $830 des $1,050 perdus sur la séance.');
  });

  it('séances précédentes : rythme et taille comparés à la médiane du compte', () => {
    const previous: PreviousSession[] = Array.from({ length: 6 }, (_, i) => ({ day: `2026-10-0${i + 1}`, trades: 2, maxQuantity: 2, net: -100 }));
    const { findings } = buildIncidentReport(input({ alerts: [], previous }));
    expect(findings).toContain('5 trades sur la séance, contre 2 en médiane sur tes 6 séances précédentes de ce compte.');
    expect(findings.join(' ')).toMatch(/Taille/);
  });

  it('moins de 5 séances précédentes : aucune comparaison', () => {
    const previous: PreviousSession[] = [{ day: '2026-10-01', trades: 1, maxQuantity: 1, net: 10 }];
    const { findings } = buildIncidentReport(input({ previous }));
    expect(findings.join(' ')).not.toMatch(/médiane|précédentes/);
  });

  it('séance à un seul trade : des repères factuels, toujours sans conseil', () => {
    const { findings } = buildIncidentReport(input({ trades: [MOCKUP_TRADES[3]], alerts: [], snapshot: { limit: 2000, remaining: -20, detectedAt: at('11:00').toISOString() } }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join(' ')).toContain('limite estimée franchie à 10:49');
  });

  it('aucun constat ne conseille, ne promet ni ne prédit', () => {
    const previous: PreviousSession[] = Array.from({ length: 6 }, (_, i) => ({ day: `2026-10-0${i + 1}`, trades: 2, maxQuantity: 1, net: -10 }));
    for (const r of [buildIncidentReport(input()), buildIncidentReport(input({ previous }))]) {
      for (const f of r.findings) expect(f).not.toMatch(ADVICE);
    }
  });
});

describe('analyse IA — prompt', () => {
  it('plafond de 400 tokens', () => {
    expect(INCIDENT_AI_MAX_TOKENS).toBe(400);
  });

  it('le système interdit conseil, prédiction et promesse, et impose la formule factuelle', () => {
    expect(INCIDENT_AI_SYSTEM).toContain("D'après tes trades enregistrés");
    expect(INCIDENT_AI_SYSTEM).toMatch(/Aucun conseil d'achat ou de vente/);
    expect(INCIDENT_AI_SYSTEM).toMatch(/aucune prédiction, aucune promesse/);
  });

  it('le message ne porte que les faits déjà calculés', () => {
    const prompt = buildIncidentPrompt('drawdown', 'USD', buildIncidentReport(input()));
    expect(prompt).toContain('Incident : plancher de drawdown estimé franchi.');
    expect(prompt).toContain('10:49 LONG MNQ x4 : -$420, marge estimée ensuite +$360 (après une alerte)');
    expect(prompt).toContain("10:44 alerte MyTradingCoach : pertes d'affilée");
    expect(prompt).toContain('- Les 2 derniers trades représentent $830 des $1,050 perdus sur la séance.');
  });
});

describe('buildIncidentReport — marge déjà sous la limite avant la séance (revue #712)', () => {
  // Casse un jour précédent, synchro après une séance gagnante : marge relevée -40 $ après +58 $.
  const already = () => buildIncidentReport(input({
    snapshot: { limit: 1000, remaining: -40, detectedAt: at('21:13').toISOString() },
    trades: [trade('w', '21:12', 'SHORT', 2, 58)],
    alerts: [],
  }));

  it('marge de départ négative : signe affiché, pas de franchissement daté', () => {
    const r = already();
    expect(r.kpis.startDistance).toBe(-98);
    const margin = r.findings.find((f) => f.includes('avant le premier trade'))!;
    expect(margin).toBe(nb('Limite estimée déjà franchie avant la séance : marge estimée de -$98 avant le premier trade.'));
    expect(r.findings.join(' ')).not.toMatch(/franchie à/);
  });

  it('franchissement pendant la séance : toujours daté, marge positive sans signe', () => {
    const r = buildIncidentReport(input());
    expect(r.findings.join(' ')).not.toMatch(/déjà franchie/);
    expect(crossingPoint(r.series)?.at).toBe(at('11:12').toISOString());
    expect(crossingPoint(already().series)).toBeNull();
  });
});

describe('buildIncidentReport — séance d\'un seul trade (revue #712)', () => {
  it('« 1 trade à 16:40 », jamais « entre 16:40 et 16:40 »', () => {
    const r = buildIncidentReport(input({ trades: [trade('x', '16:40', 'LONG', 5, -3000)], alerts: [] }));
    expect(r.findings).toContain('Séance de 1 trade à 16:40, pour -$3,000.');
    expect(r.findings.join(' ')).not.toMatch(/entre 16:40 et 16:40/);
  });
});

describe('distanceSeries — une seule source pour la marge de départ et la chronologie (A5)', () => {
  // Plan trailing intraday de 2 500 $ : premier trade gagnant (+80), le plancher monte avec lui.
  const trailingInput = (over: Partial<IncidentReportInput> = {}) => input({
    snapshot: { limit: 2500, remaining: -80, detectedAt: at('11:13').toISOString() },
    trades: [trade('g', '09:34', 'LONG', 2, 80), trade('p1', '10:10', 'SHORT', 2, -1300), trade('p2', '11:12', 'SHORT', 4, -1280)],
    alerts: [],
    trailing: true,
    ...over,
  });

  it('trailing, premier trade gagnant : marge de départ = drawdown du plan (2 500 $), pas 2 420 $', () => {
    const r = buildIncidentReport(trailingInput());
    expect(r.kpis.startDistance).toBe(2500);
    expect(r.series.map((p) => p.distance)).toEqual([2500, 2500, 1200, -80]);
    // Chronologie et carte lisent la même suite : la marge après le dernier trade est celle relevée.
    const after = r.timeline.flatMap((e) => (e.type === 'trade' ? [e.distanceAfter] : []));
    expect(after).toEqual(r.series.slice(1).map((p) => p.distance));
  });

  it('trailing, plus haut d’avant la séance sous celui de la séance : plancher de départ plus haut', () => {
    // Plus haut d'avant à +50 : plancher de départ -2 450, puis poussé à -2 420 par le +80.
    const r = buildIncidentReport(trailingInput({ peakAboveStart: 50 }));
    expect(r.series.map((p) => p.distance)).toEqual([2450, 2500, 1200, -80]);
  });

  it('trailing, plus haut d’avant la séance au-dessus de la séance : le plancher ne bouge pas', () => {
    // Plancher déjà à 200 − 2 500 = -2 300 : le +80 ne le pousse pas, la marge relevée est -200.
    const r = buildIncidentReport(trailingInput({ peakAboveStart: 200, snapshot: { limit: 2500, remaining: -200, detectedAt: at('11:13').toISOString() } }));
    expect(r.series.map((p) => p.distance)).toEqual([2300, 2380, 1080, -200]);
  });

  it('trailing figé (plancher au relevé sous ce que la séance pouvait pousser) : plancher fixe', () => {
    // Marge relevée 120 : plancher au relevé = -2 500 − 120 = -2 620, sous 80 − 2 500 → n'a pas bougé.
    const r = buildIncidentReport(trailingInput({ snapshot: { limit: 2500, remaining: 120, detectedAt: at('11:13').toISOString() } }));
    expect(r.series.map((p) => p.distance)).toEqual([2620, 2700, 1400, 120]);
  });

  it('plancher fixe (statique) : le gain du premier trade agrandit la marge', () => {
    const r = buildIncidentReport(trailingInput({ trailing: false, snapshot: { limit: 2500, remaining: 0, detectedAt: at('11:13').toISOString() } }));
    expect(r.kpis.startDistance).toBe(2500);
    expect(r.series.map((p) => p.distance)).toEqual([2500, 2580, 1280, 0]);
  });

  it('perte du jour : jamais traitée comme un plancher trailing', () => {
    const d = distanceSeries([{ tradedAt: at('09:34'), net: 80 }, { tradedAt: at('10:00'), net: -600 }], {
      kind: 'daily_loss', trailing: true, snapshot: { limit: 500, remaining: -20, detectedAt: at('10:01').toISOString() },
    });
    expect(d).toEqual({ start: 500, after: [580, -20] });
  });
});

describe('distanceSeries — trade daté après la détection (A6)', () => {
  it('seul trade sorti après le relevé : ni « déjà franchie » ni marge de départ négative', () => {
    const r = buildIncidentReport(input({
      snapshot: { limit: 2000, remaining: -100, detectedAt: at('10:00').toISOString() },
      trades: [trade('late', '10:05', 'LONG', 2, -900)],
      alerts: [],
    }));
    expect(r.kpis.startDistance).toBeNull();
    expect(r.series).toEqual([]);
    expect(r.findings.join(' ')).not.toMatch(/déjà franchie|marge estimée/i);
  });

  it('position ouverte au franchissement avec une marge de départ positive : toujours calculée', () => {
    const r = buildIncidentReport(input({ snapshot: { limit: 2000, remaining: 360, detectedAt: at('10:50').toISOString() } }));
    expect(r.kpis.startDistance).toBe(1000);
  });
});

describe('textes générés — espace insécable devant : ; ! ? % (A2)', () => {
  it('aucun constat ni libellé d’alerte avec une espace normale devant ces signes', () => {
    const previous: PreviousSession[] = Array.from({ length: 6 }, (_, i) => ({ day: `2026-10-0${i + 1}`, trades: 2, maxQuantity: 1, net: -10 }));
    const alerts: IncidentReportInput['alerts'] = [
      { at: at('10:00'), source: 'prop', type: 'drawdown', level: 'warning' },
      { at: at('10:30'), source: 'prop', type: 'daily_loss', level: 'critical' },
      { at: at('10:44'), source: 'behavior', type: 'C1_LOSS_STREAK' },
    ];
    const reports = [
      buildIncidentReport(input()),
      buildIncidentReport(input({ previous, alerts })),
      buildIncidentReport(input({ alerts, snapshot: { limit: 1000, remaining: -40, detectedAt: at('21:13').toISOString() } })),
      buildIncidentReport(input({ trades: [MOCKUP_TRADES[3]], alerts: [] })),
    ];
    const texts = reports.flatMap((r) => [
      ...r.findings,
      ...r.timeline.flatMap((e) => (e.type === 'alert' ? [e.label] : [])),
    ]);
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) expect(t).not.toMatch(/ [:;!?%]/);
  });
});
