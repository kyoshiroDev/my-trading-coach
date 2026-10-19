import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMPAIGNS } from './campaigns/campaign-registry';
import { welcomeFreeTemplate } from './templates';

// Chaque lien d'e-mail vers l'app doit mener à une route qui existe (un lien mort `/parametres` est
// resté des mois dans le pied commun, et `/trades` dans la relance premier trade).

const APP_DIR = join(__dirname, '../../../../app-mytradingcoach');
const ROUTES_SRC = readFileSync(join(APP_DIR, 'src/app/app.routes.ts'), 'utf8');
/** Chemins déclarés (`path: 'x'`, redirections comprises), hors joker. */
const ROUTES = new Set([...ROUTES_SRC.matchAll(/path:\s*'([^']*)'/g)].map((m) => m[1]).filter((p) => p !== '**'));

function assertAppPath(path: string, where: string) {
  const clean = path.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
  if (/\.[a-z0-9]+$/i.test(clean)) {
    // Fichier statique servi par l'app (logo des e-mails).
    expect(existsSync(join(APP_DIR, 'public', clean)), `${where} : ${path}`).toBe(true);
    return;
  }
  expect(ROUTES.has(clean), `${where} : ${path} (routes : ${[...ROUTES].join(', ')})`).toBe(true);
}

describe('liens des e-mails vers l’app', () => {
  it('la liste des routes est bien lue', () => {
    expect(ROUTES).toContain('dashboard');
    expect(ROUTES).toContain('profil');
    expect(ROUTES).not.toContain('parametres');
  });

  it('dans le code : tout `${appUrl|frontendUrl}/chemin` des modules e-mail mène à une route existante', () => {
    const files = [
      'templates/index.ts',
      'campaigns/campaign-templates.ts',
      'resend.service.ts',
    ];
    let checked = 0;
    for (const file of files) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      for (const m of src.matchAll(/(?:appUrl|frontendUrl|FRONTEND_URL'\] \?\? '[^']+')\}?(\/[a-zA-Z0-9/_.-]*)/g)) {
        assertAppPath(m[1], file);
        checked++;
      }
      // Lien en dur vers l'app de prod : interdit (l'environnement vient de FRONTEND_URL).
      expect(src, file).not.toMatch(/https:\/\/app\.mytradingcoach\.app\/[a-z]/);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('rendu : chaque lien vers l’app de chaque campagne et de la bienvenue mène à une route existante', () => {
    const appUrl = 'https://app.test';
    const ctx = {
      userName: 'Alex', appUrl, unsubUrl: 'https://api.test/u', propFirmCount: 16, seatsLeft: 150, seatsTotal: 200,
      firstWeek: { trades: 3, days: 2, pnl: '+$10.00' },
    };
    const htmls = [...CAMPAIGNS.map((c) => [c.key, c.build(ctx).html]), ['welcome', welcomeFreeTemplate({ userName: 'Alex', appUrl }).html]];
    for (const [key, html] of htmls) {
      for (const m of html.matchAll(/href="https:\/\/app\.test([^"]*)"/g)) assertAppPath(m[1] || '/', key);
    }
  });

  it('pied commun : désinscription en un clic quand l’e-mail en a une, sinon préférences du profil', () => {
    const c = CAMPAIGNS.find((x) => x.key === 'discord_invite')!;
    const html = c.build({ userName: '', appUrl: 'https://app.test', unsubUrl: 'https://api.test/u?token=t' }).html;
    const footer = html.slice(html.indexOf('<!-- FOOTER -->'));
    expect(footer).toContain('href="https://api.test/u?token=t"');
    const welcome = welcomeFreeTemplate({ userName: '', appUrl: 'https://app.test' }).html;
    expect(welcome.slice(welcome.indexOf('<!-- FOOTER -->'))).toContain('/profil?tab=params');
  });
});
