/**
 * Visuel et légende Instagram d'un gagnant du tirage mensuel (PROMPT-tirage-mensuel, lot C).
 * Fonctions pures, testées seules : gabarit HTML fixe (rendu en PNG 1080×1350 par puppeteer),
 * légende de repli sans IA, contrôles de la légende (prix, tiret cadratin, hashtags).
 */
import { GiveawayPool } from '@prisma/client';
import { findForbiddenTerms } from '../../common/ai-text-guard/ai-text-guard';
import { instagramFontFaces } from './giveaway-instagram.fonts';

export const INSTAGRAM_IMAGE_WIDTH = 1080;
export const INSTAGRAM_IMAGE_HEIGHT = 1350;
/** Instagram via l'API Metricool : 5 hashtags au plus. */
export const INSTAGRAM_MAX_HASHTAGS = 5;
export const INSTAGRAM_CAPTION_MAX = 1200;

export interface InstagramWinnerFacts {
  /** Nom affiché selon l'accord du gagnant (« Un trader » sans accord). */
  displayName: string;
  /** Pseudo Instagram donné par le gagnant (sans « @ »), sinon null. */
  instagramHandle: string | null;
  pool: GiveawayPool;
  prizeMonths: number;
  /** « février 2027 ». */
  periodLabel: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** « 1 mois de Premium offert » / « 3 mois d'abonnement offerts ». */
export function prizeLabel(pool: GiveawayPool, months: number): string {
  return pool === GiveawayPool.FREE
    ? `${months}\u00a0mois de Premium offert${months > 1 ? 's' : ''}`
    : `${months}\u00a0mois d’abonnement offerts`;
}

/** Période « 2027-02 » → « février 2027 ». */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Gabarit fixe aux couleurs de l'app (« The Terminal ») : fond nuit, accent bleu, polices de la marque
 * intégrées en data URI (aucune requête externe pendant le rendu, police système si absentes). Couleurs en dur : image rendue côté serveur, hors CSS de l'app.
 */
export function instagramImageHtml(f: InstagramWinnerFacts, fontFaces = instagramFontFaces()): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  ${fontFaces}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${INSTAGRAM_IMAGE_WIDTH}px;height:${INSTAGRAM_IMAGE_HEIGHT}px}
  body{background:#080c14;color:#e2eaf5;font-family:'Inter','Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:110px 96px;position:relative;overflow:hidden}
  body::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 80% 0%,rgba(59,130,246,.28),transparent 55%)}
  .top,.mid,.bottom{position:relative}
  .eyebrow{font-family:'JetBrains Mono','Courier New',monospace;font-size:30px;letter-spacing:6px;text-transform:uppercase;color:#60a5fa}
  .period{font-size:40px;color:#8fa3bf;margin-top:18px}
  .label{font-size:44px;color:#8fa3bf;margin-bottom:28px}
  .name{font-size:104px;font-weight:800;letter-spacing:-2px;line-height:1.05;word-break:break-word}
  .prize{margin-top:56px;display:inline-block;font-size:56px;font-weight:700;padding:28px 44px;border-radius:28px;background:#101d2e;border:2px solid rgba(99,155,255,.25);color:#60a5fa}
  .brand{font-size:44px;font-weight:700;letter-spacing:-.5px}
  .brand span{color:#60a5fa}
  .note{font-size:28px;color:#8fa3bf;margin-top:14px}
</style></head><body>
  <div class="top"><div class="eyebrow">Tirage du mois</div><div class="period">${esc(f.periodLabel)}</div></div>
  <div class="mid"><div class="label">Gagnant du tirage</div><div class="name">${esc(f.displayName)}</div><div class="prize">${esc(prizeLabel(f.pool, f.prizeMonths))}</div></div>
  <div class="bottom"><div class="brand">MyTrading<span>Coach</span></div><div class="note">Journal de trading · tirage au sort mensuel</div></div>
</body></html>`;
}

/** Légende sans IA (IA coupée ou en échec) : seulement les vraies données du gagnant. */
export function fallbackCaption(f: InstagramWinnerFacts): string {
  const who = f.instagramHandle ? `@${f.instagramHandle}` : f.displayName;
  return [
    `Tirage du mois de ${f.periodLabel}\u00a0: bravo à ${who}, qui gagne ${prizeLabel(f.pool, f.prizeMonths)} sur MyTradingCoach.`,
    'Chaque mois, un tirage au sort parmi les traders qui enregistrent leurs trades. Conditions dans le règlement.',
    '#journaldetrading #trading #propfirm',
  ].join('\n\n');
}

/**
 * Nettoie et contrôle une légende (IA ou modifiée par l'admin) : tirets cadratin et demi-cadratin
 * remplacés, hashtags limités à 5, longueur bornée. Renvoie aussi les problèmes bloquants : prix
 * (€, $, euros), termes interdits (promesse de gain, conseil), pour refuser la publication.
 */
export function checkCaption(raw: string): { caption: string; problems: string[] } {
  let caption = raw.replace(/\s*[—–]\s*/g, ', ').replace(/\r/g, '').trim();
  let tags = 0;
  caption = caption.replace(/#[\p{L}\p{N}_]+/gu, (tag) => (++tags <= INSTAGRAM_MAX_HASHTAGS ? tag : '')).replace(/[ \t]+\n/g, '\n').trim();
  if (caption.length > INSTAGRAM_CAPTION_MAX) caption = caption.slice(0, INSTAGRAM_CAPTION_MAX).trim();
  const problems: string[] = [];
  if (!caption) problems.push('vide');
  if (/[€$]|\beuros?\b|\bdollars?\b/i.test(caption)) problems.push('prix');
  for (const id of findForbiddenTerms(caption)) problems.push(id);
  return { caption, problems };
}
