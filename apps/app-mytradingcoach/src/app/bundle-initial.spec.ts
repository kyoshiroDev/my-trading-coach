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

  it('le barrel @mtc/front-ui n’exporte pas le dialogue (sinon il resterait dans le bundle initial)', () => {
    expect(frontUi).not.toMatch(/^export .*confirm-dialog\.component/m);
    expect(frontUi).toMatch(/^export \* from '\.\/lib\/confirm-dialog\/confirm\.service';/m);
  });
});
