import { describe, it, expect } from 'vitest';
import { detectDelimiter, identificationKind, redactForAi, scrubCell } from './csv-ai-redaction';
import { splitCsvLine } from './csv-parsers';

/** Données envoyées à l'IA pour un broker inconnu : valeurs d'identification masquées, en-tête intact. */

describe('identificationKind · colonnes reconnues par leur en-tête', () => {
  it.each([
    ['Account', 'compte'], ['Account Number', 'compte'], ['N° de compte', 'compte'], ['Compte', 'compte'],
    ['Client ID', 'personne'], ['Customer Name', 'personne'], ['Login', 'personne'], ['Full Name', 'personne'],
    ['E-mail', 'email'], ['Email Address', 'email'],
    ['Order ID', 'id'], ['OrderId', 'id'], ['Ticket', 'id'], ['Trade ID', 'id'], ['Order #', 'id'], ['UID', 'id'],
  ])('%s → %s', (header, kind) => {
    expect(identificationKind(header)).toBe(kind);
  });

  it.each(['Symbol', 'Side', 'Qty', 'Entry Price', 'Close Time', 'Realized PnL', 'Commission', 'Name', 'Order', 'Position', 'Trade'])(
    '%s : utile au parsing, jamais masquée',
    (header) => {
      expect(identificationKind(header)).toBeNull();
    },
  );
});

describe('scrubCell · texte libre', () => {
  it('masque e-mails et longues suites de chiffres dans un texte', () => {
    expect(scrubCell('Compte 98765432 de jean.dupont@mail.fr')).toBe('Compte [num] de [email]');
  });

  it('ne touche ni aux nombres, ni aux horodatages, ni aux dates compactes', () => {
    for (const v of ['19850.25', '-1,234.50', '1729700000000', '20241023', '20241023 142201', '2024-10-23 14:22:01', 'MNQZ4']) {
      expect(scrubCell(v)).toBe(v);
    }
  });
});

describe('redactForAi', () => {
  const lines = [
    'Account,Order ID,Symbol,Side,Qty,Price,Close Time,PnL,Comment',
    'ACC-778899,1001,MNQZ4,Buy,2,19850.25,2024-10-23 14:22:01,-40.5,"Ordre client 12345678, ok"',
    'ACC-778899,1001,MNQZ4,Sell,2,19840.00,2024-10-23 14:30:00,0,ras',
    'ACC-112233,1002,MESZ4,Buy,1,5620.5,2024-10-23 15:00:00,12,contact@broker.com',
  ];

  it('en-tête intact, nombre de colonnes conservé (index du mapping justes)', () => {
    const out = redactForAi(lines);
    expect(out[0]).toBe(lines[0]);
    for (const l of out.slice(1)) expect(splitCsvLine(l).length).toBe(9);
  });

  it('valeurs d’identification remplacées par des jetons stables, le reste intact', () => {
    const rows = redactForAi(lines).slice(1).map((l) => splitCsvLine(l));
    expect(rows.map((r) => r[0])).toEqual(['compte-1', 'compte-1', 'compte-2']);
    expect(rows.map((r) => r[1])).toEqual(['id-1', 'id-1', 'id-2']); // même ordre, même jeton
    expect(rows[0].slice(2, 8)).toEqual(['MNQZ4', 'Buy', '2', '19850.25', '2024-10-23 14:22:01', '-40.5']);
    expect(rows[0][8]).toBe('Ordre client [num], ok');
    expect(rows[2][8]).toBe('[email]');
    expect(redactForAi(lines).join('\n')).not.toMatch(/778899|112233|12345678|broker\.com/);
  });

  it('séparateur point-virgule ou tabulation reconnu', () => {
    expect(detectDelimiter('Compte;Symbole;Prix')).toBe(';');
    expect(detectDelimiter('Account\tSymbol\tPrice')).toBe('\t');
    const out = redactForAi(['Compte;Symbole;Prix', '556677;EURUSD;1,0850']);
    expect(out[1]).toBe('compte-1;EURUSD;1,0850');
  });
});
