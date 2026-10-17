import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { IN_APP_UA_PATTERN } from '@mtc/shared';
import { environment as prod } from './environments/environment.production';
import { environment as beta } from './environments/environment.beta';
import { environment as dev } from './environments/environment.dev';

// Script inline `register_view` d'index.html : il ne peut rien importer, ce test garde ses
// constantes alignées sur leurs sources (motif du navigateur intégré, URL de l'API par hôte).
const html = readFileSync(resolve(import.meta.dirname, 'index.html'), 'utf8');
const script = /<script id="mtc-register-view">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0';
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Contenu d'un Blob (jsdom n'implémente pas `Blob.text()`). */
const readBlob = (b: Blob) =>
  new Promise<string>((done) => {
    const r = new FileReader();
    r.onload = () => done(r.result as string);
    r.readAsText(b);
  });

interface Run {
  win: { mtcRegisterView?: boolean };
  sent: { url: string; body: Record<string, unknown> }[];
}

function memoryStorage(init: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}

async function run(
  url: string,
  opts: { ua?: string; local?: Record<string, string>; session?: Record<string, string>; referrer?: string } = {},
): Promise<Run> {
  const u = new URL(url);
  const win: Run['win'] = {};
  const blobs: [string, Blob][] = [];
  const navigatorStub = {
    userAgent: opts.ua ?? SAFARI_UA,
    sendBeacon: (to: string, blob: Blob) => (blobs.push([to, blob]), true),
  };
  new Function('window', 'location', 'navigator', 'localStorage', 'sessionStorage', 'document', script)(
    win,
    { pathname: u.pathname, search: u.search, hostname: u.hostname },
    navigatorStub,
    memoryStorage(opts.local),
    memoryStorage(opts.session),
    { referrer: opts.referrer ?? '' },
  );
  const sent = await Promise.all(blobs.map(async ([to, b]) => {
    expect(b.type).toBe('text/plain');
    return { url: to, body: JSON.parse(await readBlob(b)) as Record<string, unknown> };
  }));
  return { win, sent };
}

describe("index.html — register_view dès l'arrivée", () => {
  beforeEach(() => expect(script).toContain('register_view'));

  it('motif du navigateur intégré identique à IN_APP_UA_PATTERN (@mtc/shared)', () => {
    expect(/var IN_APP = '([^']*)'/.exec(script)?.[1]).toBe(IN_APP_UA_PATTERN);
  });

  it("URL de l'API de chaque environnement déployé = celle de l'app (environment.*.ts)", async () => {
    for (const [host, env] of [['app', prod], ['beta.app', beta], ['dev.app', dev]] as const) {
      const { sent } = await run(`https://${host}.mytradingcoach.app/register`);
      expect(sent[0].url).toBe(`${env.apiUrl}/public/funnel`);
    }
  });

  it('envoie register_view avec les UTM du lien et inApp, et marque le chargement comme traité', async () => {
    const { win, sent } = await run(
      'https://app.mytradingcoach.app/register?utm_source=instagram&utm_medium=paid&utm_campaign=gratuit-reel',
      { ua: IG_UA },
    );
    expect(sent.map((s) => s.body)).toEqual([
      { step: 'register_view', source: 'instagram', medium: 'paid', campaign: 'gratuit-reel', inApp: true },
    ]);
    expect(win.mtcRegisterView).toBe(true);
  });

  it("sans UTM dans l'URL : origine gardée pour l'onglet (mtc_utm), sinon site d'origine", async () => {
    const stored = await run('https://app.mytradingcoach.app/register', {
      session: { mtc_utm: JSON.stringify({ acquisitionSource: 'x', acquisitionMedium: 'y' }) },
    });
    expect(stored.sent[0].body).toEqual({ step: 'register_view', source: 'x', medium: 'y', inApp: false });

    const ref = await run('https://app.mytradingcoach.app/register/', { referrer: 'https://www.ninjatrader.com/ecosystem' });
    expect(ref.sent[0].body).toMatchObject({ source: 'ninjatrader.com', medium: 'referral' });

    const own = await run('https://app.mytradingcoach.app/register', { referrer: 'https://www.mytradingcoach.app/' });
    expect(own.sent[0].body).toEqual({ step: 'register_view', inApp: false });
  });

  it("déjà connecté ou mode interne : rien n'est envoyé, mais l'app ne doit pas renvoyer non plus", async () => {
    const logged = await run('https://app.mytradingcoach.app/register', {
      local: { access_token: 'jwt', user: '{}' },
    });
    expect(logged.sent).toEqual([]);
    expect(logged.win.mtcRegisterView).toBe(true);

    const internal = await run('https://app.mytradingcoach.app/register', { local: { mtc_internal: '1' } });
    expect(internal.sent).toEqual([]);
    expect((await run('https://app.mytradingcoach.app/register?internal=1')).sent).toEqual([]);
    // ?internal=0 l'emporte sur le mode mémorisé.
    expect(
      (await run('https://app.mytradingcoach.app/register?internal=0', { local: { mtc_internal: '1' } })).sent,
    ).toHaveLength(1);
  });

  it("autre page ou hôte local : rien, l'app garde la main", async () => {
    for (const url of ['https://app.mytradingcoach.app/login', 'http://localhost:4200/register']) {
      const { win, sent } = await run(url);
      expect(sent).toEqual([]);
      expect(win.mtcRegisterView).toBeUndefined();
    }
  });
});
