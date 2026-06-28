import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface StatementLine {
  filleul: string;
  amount: number;
}

export interface StatementData {
  ambassadorName: string;
  ambassadorEmail: string;
  period: string; // YYYY-MM
  lines: StatementLine[];
  total: number;
}

const TEAL = rgb(0, 0.42, 0.36);
const DARK = rgb(0.1, 0.12, 0.15);
const GREY = rgb(0.45, 0.48, 0.52);

/**
 * Relevé de commissions ambassadeur — ce n'est PAS une facture (aucune mention
 * légale, aucun SIRET). Il sert de base à la facture émise par l'ambassadeur.
 */
export async function buildStatementPdf(data: StatementData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4 portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 56; // marge
  let y = 786;

  const text = (s: string, x: number, size: number, f = font, color = DARK) =>
    page.drawText(s, { x, y, size, font: f, color });

  // En-tête
  text('MyTradingCoach', M, 12, bold, TEAL);
  y -= 34;
  text('Releve de commissions', M, 22, bold);
  y -= 18;
  text("Ce document n'est pas une facture.", M, 11, font, GREY);

  // Méta
  y -= 36;
  text('Ambassadeur', M, 10, bold, GREY);
  text('Periode', 360, 10, bold, GREY);
  y -= 16;
  text(data.ambassadorName || data.ambassadorEmail, M, 12);
  text(data.period, 360, 12);
  y -= 16;
  text(data.ambassadorEmail, M, 10, font, GREY);

  // Tableau
  y -= 40;
  page.drawLine({ start: { x: M, y: y + 14 }, end: { x: 539, y: y + 14 }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  text('Filleul', M, 10, bold, GREY);
  text('Commission', 440, 10, bold, GREY);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: 539, y }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  y -= 22;

  if (data.lines.length === 0) {
    text('Aucune commission sur la periode.', M, 11, font, GREY);
    y -= 22;
  } else {
    for (const line of data.lines) {
      text(line.filleul, M, 11);
      text(`${line.amount.toFixed(2)} EUR`, 440, 11);
      y -= 22;
      if (y < 120) break; // garde-fou une page
    }
  }

  // Total
  page.drawLine({ start: { x: M, y: y + 6 }, end: { x: 539, y: y + 6 }, thickness: 1, color: rgb(0.85, 0.87, 0.9) });
  y -= 18;
  text('Total du', M, 12, bold);
  text(`${data.total.toFixed(2)} EUR`, 440, 12, bold, TEAL);

  // Pied
  y = 84;
  text('Ce releve sert de base a ta facture.', M, 11, font, GREY);
  y -= 16;
  text('La facture reste emise par l\'ambassadeur.', M, 9, font, GREY);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
