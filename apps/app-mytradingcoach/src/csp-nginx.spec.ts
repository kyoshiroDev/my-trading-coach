import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { environment as prod } from './environments/environment.production';
import { environment as beta } from './environments/environment.beta';
import { environment as dev } from './environments/environment.dev';

// CSP de l'app et de l'admin (#1068), servie par infra/static/nginx/spa-releases.conf. Les scripts
// inline y sont autorisés par leur empreinte : modifier un script d'index.html sans recalculer son
// empreinte le ferait bloquer en prod. Ce test garde la conf alignée sur les index et les environnements.
const root = resolve(import.meta.dirname, '../../..');
const conf = readFileSync(resolve(root, 'infra/static/nginx/spa-releases.conf'), 'utf8');
const header = /add_header Content-Security-Policy(?:-Report-Only)? "([^"]+)";/.exec(conf)?.[1] ?? '';
const directive = (name: string) =>
  header
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name)
    ?.slice(1) ?? [];

const sha256 = (code: string) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
const indexes = ['apps/app-mytradingcoach/src/index.html', 'apps/admin-mytradingcoach/src/index.html'].map((p) =>
  readFileSync(resolve(root, p), 'utf8'),
);

describe('CSP de spa-releases.conf (#1068)', () => {
  it('la conf sert une politique', () => {
    expect(header).not.toBe('');
  });

  it("chaque script inline des index de l'app et de l'admin est autorisé par son empreinte", () => {
    const inline = indexes.flatMap((html) =>
      [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]),
    );
    expect(inline.length).toBeGreaterThan(0);
    for (const code of inline) expect(directive('script-src')).toContain(sha256(code));
  });

  it('chaque gestionnaire inline (onload…) des index et du CSS critique est autorisé', () => {
    const handlers = indexes.flatMap((html) => [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map((m) => m[1]));
    // Ajouté au build par l'inlining du CSS critique (feuille de style chargée en media="print").
    handlers.push("this.media='all'");
    expect(directive('script-src')).toContain("'unsafe-hashes'");
    for (const code of handlers) expect(directive('script-src')).toContain(sha256(code));
  });

  it("l'API et le WebSocket de chaque environnement déployé sont autorisés", () => {
    const connect = directive('connect-src');
    for (const env of [prod, beta, dev]) {
      expect(connect).toContain(new URL(env.apiUrl).origin);
      expect(connect).toContain(new URL(env.wsUrl).origin.replace(/^https:/, 'wss:'));
    }
  });

  it('aucun repli permissif', () => {
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
    expect(directive('script-src')).not.toContain("'unsafe-eval'");
    expect(directive('object-src')).toEqual(["'none'"]);
  });
});
