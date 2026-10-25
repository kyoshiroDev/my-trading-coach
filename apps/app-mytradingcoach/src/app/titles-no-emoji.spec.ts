// @vitest-environment node
/**
 * Aucun emoji dans les titres : icônes Lucide à la place (règle « icônes Lucide » de angular.md et
 * design.md ; seules les émotions trader, rendues par EmotionEmojiPipe, échappent à la règle).
 *
 * Lu dans les gabarits sources (jsdom ne sert à rien ici) : titres h1 à h6, éléments dont la classe
 * porte « title », « label », « lbl » ou « head », et titre de page passé à `<mtc-topbar title="…">`. RESTANTS liste les emojis de titre encore
 * présents (relevés le 25/10/2026), à remplacer dans des PR séparées : un emoji AJOUTÉ fait échouer
 * le test, un emoji RETIRÉ aussi tant que la liste n'est pas mise à jour (elle doit rester exacte).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RESTANTS = [
  'features/auth/google-finalize.component.html · Bienvenue 👋',
  'features/dashboard/dashboard.component.html · Fais ton premier pas 🚀',
  'features/eco-calendar/eco-calendar.component.html · ⭐', // en-tête « Ma sélection »
  'features/eco-calendar/eco-event-row.component.ts · 📌',
  'features/journal/journal.component.html · ↔️', // en-tête de la modale « Déplacer la journée »
  'features/journal/journal.component.html · 🗑️', // en-tête de la modale « Supprimer la journée »
  'features/profile/profile.component.html · 🎁 Essai gratuit',
  'features/profile/profile.component.html · 🎁 Premium offert',
  'features/scoring/scoring.component.html · 🎖 Badges obtenus',
  'features/scoring/scoring.component.html · 📅 Streak & activité',
  'features/sessions/sessions.component.html · 💭 Question de réflexion',
  'features/sessions/sessions.component.html · 📉 Drawdown intra-session',
  'features/sessions/sessions.component.html · 📊 Contexte marché',
  'features/sessions/sessions.component.html · 📋 Plan du jour',
  'features/sessions/sessions.component.html · 📓 Journal',
  'features/sessions/sessions.component.html · 🏆 Meilleur trade',
];

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
      const court = txt.split(/\s*[:·]\s/)[0].replace(/\s+(Bienvenue)\s+👋.*/, ' $1 👋').trim();
      out.add(`${relative(APP, f)} · ${court.includes('Bienvenue') ? 'Bienvenue 👋' : court}`);
    }
  }
  return [...out].sort();
}

describe('titres sans emoji (icônes Lucide)', () => {
  it('aucun nouvel emoji de titre, et la liste des restants est à jour', () => {
    expect(titresAvecEmoji()).toEqual([...RESTANTS].sort());
  });

  it('Parrainage, Ambassadeur, Devenir ambassadeur : titres en icônes Lucide', () => {
    const pages = [
      ['features/ambassador/ambassador.component.html', ['HandshakeIcon', 'ClipboardListIcon', 'ReceiptIcon']],
      ['features/referral/referral.component.ts', ['GiftIcon']],
      ['features/become-ambassador/become-ambassador.component.ts', ['HandshakeIcon', 'ClipboardListIcon', 'SendIcon']],
    ] as const;
    for (const [f, icones] of pages) {
      const src = readFileSync(join(APP, f), 'utf-8');
      for (const ic of icones) expect(src, `${f} : ${ic}`).toContain(`[lucideIcon]="${ic}"`);
    }
  });
});
