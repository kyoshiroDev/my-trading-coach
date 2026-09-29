/**
 * Le chemin mapping remplace 17 appels IA par un seul : le modele deduit les colonnes,
 * ce code parse le reste. Ce qui doit rester verrouille, c'est le garde-fou — mesure du
 * 2026-09-28 : les modeles identifient les colonnes de maniere fiable (30/30) mais se
 * trompent de SENS 2 fois sur 5, et une inversion transforme tous les longs en shorts
 * sans qu'aucune erreur ne remonte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMapping,
  detectDateFormat,
  parseBrokerDate,
  applyMappingWithPnlCheck,
  parseBrokerNumber,
  pnlCoherence,
  validateMappingShape,
  type CsvMapping,
} from './csv-mapping';

const TRADOVATE = readFileSync(
  join(__dirname, '__fixtures__', 'tradovate-performance.csv'),
  'utf8',
).split('\n').filter(Boolean);

/** Le mapping que le modele a reellement produit sur ce fichier (7/7 criteres). */
const MAPPING_TRADOVATE: CsvMapping = {
  delimiter: ',',
  decimalSeparator: '.',
  dateFormat: 'mdy',
  columns: { symbol: 0, entry: 7, exit: 8, quantity: 6, pnl: 9, tradedAt: 11 },
  side: {
    mode: 'derived_from_timestamps',
    index: null, longValues: [], shortValues: [],
    buyTimeIndex: 10, sellTimeIndex: 11,
  },
  pnlExtraColumns: [],
};

describe('parseBrokerNumber — les nombres tels que les brokers les ecrivent', () => {
  it.each([
    ['73,602.51', '.' as const, 73602.51, 'separateur de milliers'],
    ['1.6202459USDT', '.' as const, 1.6202459, 'suffixe de devise'],
    ['$23.00', '.' as const, 23, 'symbole monetaire'],
    ['(11.50)', '.' as const, -11.5, 'parentheses = negatif'],
    ['$(125.00)', '.' as const, -125, 'Tradovate : le $ est HORS de la parenthese'],
    ['$(1,250.00)', '.' as const, -1250, 'le $ hors parenthese, avec milliers'],
    ['1.234,56', ',' as const, 1234.56, 'format europeen'],
    ['-6.5727459USDT', '.' as const, -6.5727459, 'negatif avec devise'],
  ])('%s (%s) -> %s : %s', (brut, sep, attendu, _libelle) => {
    expect(parseBrokerNumber(brut, sep)).toBeCloseTo(attendu, 6);
  });

  it('une cellule vide ou non numerique ne vaut pas 0 mais NaN', () => {
    // Renvoyer 0 ferait passer une ligne cassee pour un trade a zero.
    expect(parseBrokerNumber('', '.')).toBeNaN();
    expect(parseBrokerNumber('n/a', '.')).toBeNaN();
  });
});

describe('validateMappingShape — un mapping invalide ne doit jamais etre applique', () => {
  const base = JSON.parse(JSON.stringify(MAPPING_TRADOVATE));

  it('accepte le mapping mesure sur le vrai fichier', () => {
    expect(validateMappingShape(base, 13)).not.toBeNull();
  });

  it('refuse un index hors du nombre de colonnes', () => {
    // Sans ce controle, la colonne lue vaut undefined sur TOUT le fichier, en silence.
    expect(validateMappingShape({ ...base, columns: { ...base.columns, pnl: 99 } }, 13)).toBeNull();
  });

  it.each([['columns'], ['side']])('refuse un objet sans %s', (cle) => {
    const casse = { ...base }; delete (casse as Record<string, unknown>)[cle];
    expect(validateMappingShape(casse, 13)).toBeNull();
  });

  it('refuse un separateur qui n est pas un seul caractere', () => {
    expect(validateMappingShape({ ...base, delimiter: '||' }, 13)).toBeNull();
  });

  it('refuse le mode horodatages sans les deux colonnes de temps', () => {
    expect(validateMappingShape(
      { ...base, side: { ...base.side, sellTimeIndex: null } }, 13,
    )).toBeNull();
  });
});

describe('applyMapping — sur le vrai export Tradovate du depot', () => {
  it('parse les 20 lignes sans en ecarter aucune', () => {
    const { rows, skipped } = applyMapping(TRADOVATE.slice(1), MAPPING_TRADOVATE);
    expect(rows).toHaveLength(20);
    expect(skipped).toBe(0);
  });

  it('un short a la VENTE pour entree et l ACHAT pour sortie', () => {
    // Les colonnes du fichier sont « prix d achat » et « prix de vente », pas entree/sortie :
    // les lire dans l ordre donnerait un P&L de signe inverse sur tous les shorts.
    const { rows } = applyMapping(TRADOVATE.slice(1), MAPPING_TRADOVATE);
    const shorts = rows.filter((r) => r.side === 'SHORT');
    expect(shorts.length).toBeGreaterThan(0);
    for (const s of shorts) {
      const gagnant = s.entry > s.exit;
      expect(gagnant).toBe(s.pnl > 0);
    }
  });

  it('le signe du P&L confirme le sens sur toutes les lignes testables', () => {
    const { rows } = applyMapping(TRADOVATE.slice(1), MAPPING_TRADOVATE);
    const { ok, testables } = pnlCoherence(rows);
    expect(testables).toBeGreaterThan(0);
    expect(ok).toBe(testables);
  });
});

describe('applyMappingWithPnlCheck — le garde-fou sur le sens', () => {
  it('mode colonne : un sens inverse est redresse par l arithmetique', () => {
    // C'est l'erreur reelle des deux modeles sur les exports de cloture, ou la colonne de
    // sens designe l'ordre de SORTIE. Ici les prix restent en place et seul le libelle du
    // sens est faux : le signe du P&L le contredit, donc on inverse.
    const lignes = [
      'BTCUSDT,Buy,60000,60500,1,500,2026-06-01 10:00:00',   // achete bas, revendu haut, gagnant
      'BTCUSDT,Buy,61000,61400,1,400,2026-06-02 10:00:00',
      'BTCUSDT,Sell,62000,61500,1,500,2026-06-03 10:00:00',  // vendu haut, rachete bas, gagnant
      'BTCUSDT,Sell,63000,62500,1,500,2026-06-04 10:00:00',
    ];
    const aLEnvers: CsvMapping = {
      delimiter: ',', decimalSeparator: '.', dateFormat: 'iso',
      columns: { symbol: 0, entry: 2, exit: 3, quantity: 4, pnl: 5, tradedAt: 6 },
      side: {
        mode: 'column', index: 1,
        longValues: ['Sell'], shortValues: ['Buy'],   // inverse a dessein
        buyTimeIndex: null, sellTimeIndex: null,
      },
      pnlExtraColumns: [],
    };

    const out = applyMappingWithPnlCheck(lignes, aLEnvers);

    expect(out.flipped).toBe(true);
    expect(out.pnlRatio).toBe(1);
    expect(out.rows.map((r) => r.side)).toEqual(['LONG', 'LONG', 'SHORT', 'SHORT']);
  });

  /**
   * Limite connue et assumee : en mode horodatages, echanger les deux colonnes de temps
   * inverse le sens ET l'entree/sortie en meme temps (`resolvePairDirection` les permute
   * avec le sens). Les deux lectures restent donc arithmetiquement coherentes et le signe
   * du P&L ne peut PAS trancher. Le risque est faible parce que ces colonnes sont nommees
   * sans ambiguite dans l'export ("boughtTimestamp" / "soldTimestamp"), mais il faut le
   * savoir avant de croire que ce garde-fou couvre tous les formats.
   */
  it('mode horodatages : le controle du P&L ne peut PAS detecter une permutation des temps', () => {
    const permute: CsvMapping = {
      ...MAPPING_TRADOVATE,
      side: { ...MAPPING_TRADOVATE.side, buyTimeIndex: 11, sellTimeIndex: 10 },
    };
    const out = applyMappingWithPnlCheck(TRADOVATE.slice(1), permute);

    expect(out.pnlRatio).toBe(1);   // coherent malgre la permutation
    expect(out.flipped).toBe(false);
  });

  it('un mapping deja juste n est pas inverse', () => {
    const out = applyMappingWithPnlCheck(TRADOVATE.slice(1), MAPPING_TRADOVATE);
    expect(out.flipped).toBe(false);
    expect(out.pnlRatio).toBe(1);
  });

  it('sans prix d entree, le sens n est PAS verifiable : pnlRatio vaut null', () => {
    // Cas type Binance Futures. C est precisement le format ou les deux modeles se sont
    // trompes de sens : l appelant doit renoncer au mapping plutot que deviner.
    const sansEntree: CsvMapping = {
      delimiter: ',', decimalSeparator: '.', dateFormat: 'iso',
      columns: { symbol: 0, entry: null, exit: 2, quantity: 3, pnl: 4, tradedAt: 5 },
      side: {
        mode: 'column', index: 1,
        longValues: ['SELL'], shortValues: ['BUY'],
        buyTimeIndex: null, sellTimeIndex: null,
      },
      pnlExtraColumns: [],
    };
    const lignes = [
      'ETHUSDT,SELL,3200,1.5,42.10,2026-06-01 10:15:00',
      'ETHUSDT,BUY,3150,2,-18.40,2026-06-02 11:00:00',
    ];
    const out = applyMappingWithPnlCheck(lignes, sansEntree);
    expect(out.rows).toHaveLength(2);
    expect(out.pnlRatio).toBeNull();
  });

  it('additionne les colonnes de P&L eclatees (profit + commission + swap)', () => {
    // MT5 n expose pas le net : sans pnlExtraColumns, les frais disparaissent du resultat.
    const mt5: CsvMapping = {
      delimiter: ',', decimalSeparator: '.', dateFormat: 'iso',
      columns: { symbol: 4, entry: 5, exit: 9, quantity: 3, pnl: 12, tradedAt: 8 },
      side: {
        mode: 'column', index: 2,
        longValues: ['buy'], shortValues: ['sell'],
        buyTimeIndex: null, sellTimeIndex: null,
      },
      pnlExtraColumns: [10, 11],
    };
    const ligne = '100001,2026-06-01 08:00:00,buy,1,EURUSD,1.08000,0,0,2026-06-01 16:00:00,1.08500,-3.00,-0.45,500.00';
    const { rows } = applyMapping([ligne], mt5);
    expect(rows[0].pnl).toBeCloseTo(500 - 3 - 0.45, 2);
  });
});

describe('parseBrokerDate — l ordre jour/mois ne se devine pas', () => {
  it('lit la meme chaine differemment selon la fiche', () => {
    // Le piege qui a decale tous les trades d un export europeen : « 01/06/2026 » vaut le
    // 1er juin chez un broker francais et le 6 janvier chez un americain.
    expect(parseBrokerDate('01/06/2026 09:30:00', 'dmy').toISOString()).toBe('2026-06-01T09:30:00.000Z');
    expect(parseBrokerDate('01/06/2026 09:30:00', 'mdy').toISOString()).toBe('2026-01-06T09:30:00.000Z');
  });

  it('reconnait l ISO quel que soit le format declare', () => {
    expect(parseBrokerDate('2026-06-01 09:30:00', 'dmy').toISOString()).toBe('2026-06-01T09:30:00.000Z');
    expect(parseBrokerDate('2026-06-01 09:30:00', 'mdy').toISOString()).toBe('2026-06-01T09:30:00.000Z');
  });

  it('refuse une date impossible plutot que de la faire deborder', () => {
    // « 31/02 » lu a l envers donnerait le 2 mars en silence.
    expect(parseBrokerDate('31/02/2026', 'mdy').getTime()).toBeNaN();
    expect(parseBrokerDate('13/13/2026', 'dmy').getTime()).toBeNaN();
  });

  it('une date sans ordre etabli garde le comportement du moteur JS', () => {
    // Aucune regression pour les brokers deja supportes : « iso » sur une date en barres
    // rend exactement ce que `new Date()` rendait avant l existence de ce champ.
    expect(parseBrokerDate('07/10/2026 15:34:00', 'iso').getTime())
      .toBe(new Date('07/10/2026 15:34:00').getTime());
  });
});

describe('detectDateFormat — prouver l ordre par les donnees', () => {
  it('une composante superieure a 12 tranche a elle seule', () => {
    expect(detectDateFormat(['01/06/2026', '25/06/2026'])).toBe('dmy');
    expect(detectDateFormat(['06/01/2026', '06/25/2026'])).toBe('mdy');
  });

  it('rend null quand les deux lectures tiennent', () => {
    // Indecidable : on ne devine pas, on garde ce que dit la fiche.
    expect(detectDateFormat(['01/06/2026', '02/07/2026'])).toBeNull();
  });

  it('reconnait l ISO', () => {
    expect(detectDateFormat(['2026-06-01 09:30:00'])).toBe('iso');
  });
});

describe('applyMappingWithPnlCheck — l ordre jour/mois est corrige par les donnees', () => {
  it('redresse une fiche qui annonce le mauvais ordre', () => {
    const m: CsvMapping = {
      delimiter: ',', decimalSeparator: '.',
      dateFormat: 'mdy',   // faux a dessein : ces dates sont en jj/mm
      columns: { symbol: 0, entry: 1, exit: 2, quantity: 3, pnl: 4, tradedAt: 5 },
      side: {
        mode: 'column', index: 6,
        longValues: ['Long'], shortValues: ['Short'],
        buyTimeIndex: null, sellTimeIndex: null,
      },
      pnlExtraColumns: [],
    };
    const lignes = [
      'MNQ,29900,29950,1,50,01/06/2026 10:00:00,Long',
      'MNQ,29900,29800,1,100,25/06/2026 10:00:00,Short',   // 25 > 12 : l ordre est prouve
    ];

    const out = applyMappingWithPnlCheck(lignes, m);

    expect(out.mapping.dateFormat).toBe('dmy');
    expect(out.rows[0].tradedAt).toBe('2026-06-01T10:00:00.000Z');
    expect(out.rows[1].tradedAt).toBe('2026-06-25T10:00:00.000Z');
  });
});
