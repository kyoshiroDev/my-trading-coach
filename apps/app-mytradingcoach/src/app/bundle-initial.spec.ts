// @vitest-environment node
/**
 * Budget du bundle initial (plafond 500 ko) : ce qui n'est pas affiché au premier écran reste hors
 * du bundle initial. Verrouillé à la source, le build ne tournant pas sous vitest. Mesures et règle :
 * angular.md, « Budget du bundle initial ».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
const routes = read('app.routes.ts');
const app = read('app.ts');
const frontUi = read('../../../../libs/front/ui/src/index.ts');

describe('Bundle initial : chargé à la demande', () => {
  it('page 404 : route paresseuse, aucun import statique', () => {
    expect(routes).not.toMatch(/import \{ NotFoundComponent \}/);
    expect(routes).toMatch(/path: '\*\*'[\s\S]*?loadComponent: \(\) =>\s*import\('\.\/shared\/components\/not-found\/not-found\.component'\)/);
  });

  it('dialogue de confirmation : derrière @defer, importé par son chemin direct', () => {
    expect(app).toMatch(/@defer \(when confirm\.pending\(\)\) \{\s*<mtc-confirm-dialog \/>\s*\}/);
    expect(app.match(/<mtc-confirm-dialog/g)).toHaveLength(1);
    expect(app).toContain("import { ConfirmDialogComponent } from '@mtc/front-ui/confirm-dialog';");
  });

  it('toasts : derrière @defer au premier toast, préchargés au repos, importés par leur chemin direct (#766)', () => {
    expect(app).toMatch(/@defer \(when toasts\.visible\(\)\.length; prefetch on idle\) \{\s*<mtc-toasts \/>\s*\}/);
    expect(app.match(/<mtc-toasts/g)).toHaveLength(1);
    expect(app).toContain("import { ToastsComponent } from './shared/components/toasts/toasts.component';");
  });

  it('page d’inscription (chargée d’office) : aucun @angular/forms, ni elle ni ses composants (#765, ~43 ko)', () => {
    const files = [
      'features/auth/register.component.ts',
      'features/auth/register.component.html',
      'features/auth/auth-layout/auth-layout.component.ts',
      'features/auth/auth-layout/signup-terms-note.component.ts',
      'shared/components/google-auth-button/google-auth-button.component.ts',
      'shared/components/eye-icon/eye-icon.component.ts',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/from ['"]@angular\/forms['"]/);
      if (f.endsWith('.html')) expect(src, f).not.toMatch(/ngModel|ngSubmit|formControl/);
    }
    // Toujours chargée d'office (fae5a8c8 : −1,3 s avant le formulaire en 4G lente).
    expect(routes).toMatch(/import \{ RegisterComponent \}/);
  });

  it('le barrel @mtc/front-ui n’exporte pas le dialogue (sinon il resterait dans le bundle initial)', () => {
    expect(frontUi).not.toMatch(/^export .*confirm-dialog\.component/m);
    expect(frontUi).toMatch(/^export \* from '\.\/lib\/confirm-dialog\/confirm\.service';/m);
  });
});
