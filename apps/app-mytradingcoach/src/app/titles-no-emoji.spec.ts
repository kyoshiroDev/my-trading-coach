// @vitest-environment node
/**
 * Aucun emoji dans les titres : icônes Lucide à la place (règle « icônes Lucide » de angular.md et
 * design.md ; seules les émotions trader, rendues par EmotionEmojiPipe, échappent à la règle).
 *
 * Lu dans les gabarits sources (jsdom ne sert à rien ici) : titres h1 à h6, éléments dont la classe
 * porte « title », « label », « lbl » ou « head », et titre de page passé à `<mtc-topbar title="…">`.
 * Plus aucun emoji de titre depuis le 25/10/2026 : RESTANTS est vide et doit le rester. Un emoji de
 * titre ajouté fait échouer le test (le message liste les fichiers et titres fautifs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RESTANTS: string[] = [];

const EMOJI = /\p{Extended_Pictographic}/u;
const TITRE = new RegExp(
  [
    String.raw`<(h[1-6])\b[^>]*>([\s\S]*?)</\1>`,
    String.raw`class="[^"]*(?:title|label|lbl|head)[^"]*"[^>]*>([\s\S]*?)</(?:div|span|p|label|button|a|h[1-6])>`,
    String.raw`<mtc-topbar\b[^>]*?\stitle="([^"]*)"`,
  ].join('|'),
  'g',
);

const APP = __dirname;
function gabarits(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return gabarits(p);
    return n.endsWith('.html') || (n.endsWith('.ts') && !n.endsWith('.spec.ts')) ? [p] : [];
  });
}

/** Titres contenant un emoji : « fichier · texte du titre » (balises et blancs retirés). */
function titresAvecEmoji(): string[] {
  const out = new Set<string>();
  for (const f of gabarits(APP)) {
    const src = readFileSync(f, 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of src.matchAll(TITRE)) {
      const txt = (m[2] ?? m[3] ?? m[4] ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/@if \([^)]*\) \{|\{\{[^}]*\}\}|[{}]|@else/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
      if (!EMOJI.test(txt)) continue;
      // Libellé stable : jusqu'à la première ponctuation forte (les comptes « 20 jours » varient).
      out.add(`${relative(APP, f)} · ${txt.split(/\s*[:·]\s/)[0].trim()}`);
    }
  }
  return [...out].sort();
}

describe('titres sans emoji (icônes Lucide)', () => {
  it('aucun nouvel emoji de titre, et la liste des restants est à jour', () => {
    expect(titresAvecEmoji()).toEqual([...RESTANTS].sort());
  });

  it('les anciens titres à emoji portent leur icône Lucide', () => {
    const pages = [
      ['features/ambassador/ambassador.component.html', ['HandshakeIcon', 'ClipboardListIcon', 'ReceiptIcon']],
      ['features/referral/referral.component.ts', ['GiftIcon']],
      ['features/become-ambassador/become-ambassador.component.ts', ['HandshakeIcon', 'ClipboardListIcon', 'SendIcon']],
      ['features/sessions/sessions.component.html', ['ClipboardListIcon', 'ChartColumnIcon', 'TrendingDownIcon', 'TrophyIcon', 'MessageCircleQuestionMarkIcon', 'BookOpenIcon']],
      ['features/scoring/scoring.component.html', ['MedalIcon', 'CalendarDaysIcon']],
      ['features/profile/profile.component.html', ['GiftIcon']],
      ['features/journal/journal.component.html', ['TrashIcon', 'ReassignIcon']],
      ['features/eco-calendar/eco-calendar.component.html', ['StarIcon']],
      ['features/dashboard/dashboard.component.html', ['RocketIcon']],
      ['features/auth/google-finalize.component.html', ['HandIcon']],
    ] as const;
    for (const [f, icones] of pages) {
      const src = readFileSync(join(APP, f), 'utf-8');
      for (const ic of icones) expect(src, `${f} : ${ic}`).toContain(`[lucideIcon]="${ic}"`);
    }
  });

  it('pastille « Plan » des lignes de Mes sessions : icône Lucide, sans emoji', () => {
    // Pas un titre (non couverte par l'inventaire) : vérifiée à part.
    const src = readFileSync(join(APP, 'features/sessions/sessions.component.html'), 'utf-8');
    const pastille = src.match(/<div class="plan-pill">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(pastille, 'pastille introuvable').not.toBe('');
    expect(pastille).toContain('[lucideIcon]="ClipboardListIcon"');
    expect(EMOJI.test(pastille)).toBe(false);
  });

  it('badge « épinglés » du calendrier éco : icône Lucide, sans emoji', () => {
    const src = readFileSync(join(APP, 'features/eco-calendar/eco-calendar.component.html'), 'utf-8');
    const badge = src.match(/<div class="eco-pins-badge">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(badge, 'badge introuvable').not.toBe('');
    expect(badge).toContain('[lucideIcon]="PinIcon"');
    expect(EMOJI.test(badge)).toBe(false);
  });

  it('Score : badges en icônes Lucide, aucun emoji ni style en ligne', () => {
    const ts = readFileSync(join(APP, 'features/scoring/scoring.component.ts'), 'utf-8');
    const html = readFileSync(join(APP, 'features/scoring/scoring.component.html'), 'utf-8');
    const badges = ts.slice(ts.indexOf('const EARNED_BADGES'), ts.indexOf('@Component'));
    expect(badges, 'listes de badges introuvables').toContain('LOCKED_BADGES');
    expect(EMOJI.test(badges.replace(/\/\/.*$/gm, ''))).toBe(false);
    expect(html).toContain('[lucideIcon]="b.icon"');
    expect(html).not.toMatch(/\{\{\s*b\.emoji\s*\}\}/);
    expect(html, 'CSS en ligne (convention : .css uniquement)').not.toMatch(/\sstyle="/);
  });
});
