// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/**
 * Service worker de l'app (`public/push-sw.js`, #666) exécuté dans un bac à sable : aucun
 * gestionnaire fetch, notification affichée depuis le payload, et au clic ouverture d'un chemin
 * interne seulement (une adresse externe envoyée par erreur ou par malveillance n'est jamais ouverte).
 */

const SOURCE = readFileSync(join(__dirname, '../../../../public/push-sw.js'), 'utf8');
const ORIGIN = 'https://app.mytradingcoach.app';

type Handler = (event: Record<string, unknown>) => void;

function load(windows: { url: string; focus: () => Promise<void>; navigate?: (u: string) => Promise<void> }[] = []) {
  const handlers: Record<string, Handler> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async (u: string) => { opened.push(u); }),
    },
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); }),
    },
  };
  runInNewContext(SOURCE, { self, URL, Date });
  const run = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  return { handlers, shown, opened, run };
}

const push = (data: unknown) => ({ data: { json: () => data } });
const click = (data: unknown, action = '') => ({ action, notification: { data, close: vi.fn() } });

describe('push-sw.js', () => {
  it('aucun gestionnaire fetch (ni cache) : seulement install, activate, push et clic', () => {
    expect(Object.keys(load().handlers).sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
    expect(SOURCE).not.toMatch(/caches\./);
  });

  it('push : titre, texte et étiquette du payload, liens revérifiés', async () => {
    const sw = load();
    await sw.run('push', push({ title: 'Apex 50K', body: 'Objectif atteint (estimation MyTradingCoach).', url: '/session', tag: 'prop-a', timestamp: 1, settingsUrl: '/profil#notifications' }));
    expect(sw.shown[0].title).toBe('Apex 50K');
    expect(sw.shown[0].options).toMatchObject({ body: 'Objectif atteint (estimation MyTradingCoach).', tag: 'prop-a', data: { url: '/session', settingsUrl: '/profil#notifications' } });
  });

  it('push illisible : notification neutre, sans planter', async () => {
    const sw = load();
    await sw.run('push', { data: { json: () => { throw new Error('pas du JSON'); } } });
    expect(sw.shown[0].title).toBe('MyTradingCoach');
  });

  it.each([null, 42, 'texte', [1]])('payload JSON %j : notification neutre, sans planter (m6)', async (payload) => {
    const sw = load();
    await sw.run('push', push(payload));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe('MyTradingCoach');
    expect(sw.shown[0].options['data']).toEqual({ url: '/', settingsUrl: '/' });
  });

  it.each([
    ['https://evil.example.com/vol', '/'],
    ['//evil.example.com/vol', '/'],
    ['/\\evil.example.com', '/'],
    ['javascript:alert(1)', '/'],
    ['session', '/'],
    ['/session', '/session'],
    ['/profil#notifications', '/profil#notifications'],
  ])('clic sur data.url = %s : ouvre %s', async (url, expected) => {
    const sw = load();
    await sw.run('notificationclick', click({ url }));
    expect(sw.opened).toEqual([`${ORIGIN}${expected}`]);
  });

  it.each(['/..//evil.example.com', '/.//evil.example.com', '/%2e%2e//evil.example.com', '/a/..//evil.example.com'])(
    'chemin qui deviendrait //hôte une fois normalisé : %s rangé comme la racine dès l’affichage (m5)',
    async (url) => {
      const sw = load();
      await sw.run('push', push({ title: 'x', body: 'y', url, settingsUrl: url }));
      expect(sw.shown[0].options['data']).toEqual({ url: '/', settingsUrl: '/' });
    },
  );

  it('adresse externe déjà filtrée à l’affichage : jamais ouverte, même si elle arrive par le push', async () => {
    const sw = load();
    await sw.run('push', push({ title: 'x', body: 'y', url: 'https://evil.example.com/' }));
    await sw.run('notificationclick', click(sw.shown[0].options['data']));
    expect(sw.opened).toEqual([`${ORIGIN}/`]);
  });

  it('action « Réglages » : ouvre la page des réglages', async () => {
    const sw = load();
    await sw.run('notificationclick', click({ url: '/session', settingsUrl: '/profil#notifications' }, 'settings'));
    expect(sw.opened).toEqual([`${ORIGIN}/profil#notifications`]);
  });

  it('une fenêtre de l’app est ouverte : premier plan et navigation, pas de nouvel onglet', async () => {
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const sw = load([{ url: `${ORIGIN}/dashboard`, focus, navigate }]);
    await sw.run('notificationclick', click({ url: '/session' }));
    expect(focus).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/session`);
    expect(sw.opened).toEqual([]);
  });

  it('seule une fenêtre d’un autre site est ouverte : nouvel onglet de l’app', async () => {
    const focus = vi.fn(async () => undefined);
    const sw = load([{ url: 'https://autre.example.com/', focus }]);
    await sw.run('notificationclick', click({ url: '/session' }));
    expect(focus).not.toHaveBeenCalled();
    expect(sw.opened).toEqual([`${ORIGIN}/session`]);
  });
});
