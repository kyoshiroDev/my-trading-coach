import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/nestjs';
import type { Breadcrumb, ErrorEvent, NodeOptions } from '@sentry/nestjs';
import { buildSentryOptions, maskText, scrubBreadcrumb, scrubEvent } from './sentry-options';

type Transport = ReturnType<NonNullable<NodeOptions['transport']>>;
type Envelope = Parameters<Transport['send']>[0];

// Valeurs fictives : aucune ne correspond à un vrai compte, jeton ou clé.
const FAKE = {
  password: 'mot-de-passe-fictif',
  refreshToken: 'refresh-fictif-123',
  bearer: 'Bearer jwt-fictif-456',
  unsubscribeToken: 'desinscription-fictive-789',
  apiKey: 'cle-api-fictive',
  userId: 'user-fictif',
};

describe('scrubEvent (#746)', () => {
  const event = (): ErrorEvent => ({
    type: undefined,
    message: 'Erreur de test',
    user: { id: FAKE.userId },
    tags: { method: 'POST', path: '/api/test' },
    request: {
      method: 'POST',
      url: `https://api.exemple.invalid/api/test?token=${FAKE.unsubscribeToken}`,
      query_string: `token=${FAKE.unsubscribeToken}`,
      data: JSON.stringify({ email: 'a@exemple.invalid', password: FAKE.password }),
      cookies: { refresh_token: FAKE.refreshToken },
      headers: {
        Authorization: FAKE.bearer,
        cookie: `refresh_token=${FAKE.refreshToken}`,
        'user-agent': 'vitest',
        'content-type': 'application/json',
      },
    },
  });

  it('retire le corps, les cookies, la query string et les en-têtes authorization / cookie', () => {
    const scrubbed = scrubEvent(event());

    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://api.exemple.invalid/api/test',
      headers: { 'user-agent': 'vitest', 'content-type': 'application/json' },
    });
    const sent = JSON.stringify(scrubbed);
    for (const secret of [FAKE.password, FAKE.refreshToken, FAKE.bearer, FAKE.unsubscribeToken]) {
      expect(sent).not.toContain(secret);
    }
  });

  it('garde user.id et le tag path', () => {
    const scrubbed = scrubEvent(event());
    expect(scrubbed.user).toEqual({ id: FAKE.userId });
    expect(scrubbed.tags).toEqual({ method: 'POST', path: '/api/test' });
  });

  it('événement sans requête (cron, file) : inchangé', () => {
    const plain: ErrorEvent = { type: undefined, message: 'cron', extra: { n: 1 } };
    expect(scrubEvent({ ...plain })).toEqual(plain);
  });

  it('masque l’identifiant client Stripe du message et des exceptions (#827)', () => {
    const scrubbed = scrubEvent({
      type: undefined,
      message: 'Subscription past_due, client cus_Fictif123',
      exception: { values: [{ type: 'StripeInvalidRequestError', value: "No such customer: 'cus_Fictif123'" }] },
    });
    expect(JSON.stringify(scrubbed)).not.toContain('cus_Fictif123');
    expect(scrubbed.exception?.values?.[0].value).toBe("No such customer: 'cus_[masqué]'");
  });
});

describe('masquage des adresses e-mail (#1263)', () => {
  // Adresses fictives (domaines réservés .invalid / example) : aucune ne correspond à une vraie boîte.
  const EMAILS = ['trader.test+essai@exemple.invalid', 'Prenom.Nom@sous.domaine.example', 'x_y-1@a-b.example'];

  it('message, message formaté et exceptions : adresses masquées, le reste intact', () => {
    const scrubbed = scrubEvent({
      type: undefined,
      message: `Envoi Resend refusé pour ${EMAILS[0]}`,
      logentry: { message: `Relance échouée (${EMAILS[1]})` },
      exception: {
        values: [
          { type: 'PrismaClientKnownRequestError', value: `Unique constraint failed on email = ${EMAILS[2]}` },
          { type: 'StripeInvalidRequestError', value: `No such customer: 'cus_Fictif123' (${EMAILS[0]})` },
        ],
      },
    });
    const sent = JSON.stringify(scrubbed);
    for (const email of EMAILS) expect(sent).not.toContain(email);
    expect(sent).not.toContain('cus_Fictif123');
    expect(scrubbed.message).toBe('Envoi Resend refusé pour [e-mail masqué]');
    expect(scrubbed.logentry?.message).toBe('Relance échouée ([e-mail masqué])');
    expect(scrubbed.exception?.values?.[0].value).toBe('Unique constraint failed on email = [e-mail masqué]');
    expect(scrubbed.exception?.values?.[1].value).toBe("No such customer: 'cus_[masqué]' ([e-mail masqué])");
  });

  it('frames de la pile : lignes de code et variables locales masquées', () => {
    const scrubbed = scrubEvent({
      type: undefined,
      exception: {
        values: [{
          type: 'Error',
          value: 'x',
          stacktrace: {
            frames: [{
              filename: 'mail.service.js',
              context_line: `  await send('${EMAILS[0]}');`,
              pre_context: [`const to = '${EMAILS[1]}';`],
              post_context: ['return;'],
              vars: { to: EMAILS[2], n: 3 as unknown as string },
            }],
          },
        }],
      },
    });
    const frame = scrubbed.exception!.values![0].stacktrace!.frames![0];
    for (const email of EMAILS) expect(JSON.stringify(scrubbed)).not.toContain(email);
    expect(frame.context_line).toBe("  await send('[e-mail masqué]');");
    expect(frame.post_context).toEqual(['return;']);
    expect(frame.vars).toEqual({ to: '[e-mail masqué]', n: 3 });
  });

  it('contre-épreuve : un texte sans adresse ne change pas (arobase seule, chemin, version)', () => {
    for (const text of ['Timeout après 30 s sur /api/trades', 'paquet @nestjs/core@11.1.0', 'compte @ 2 %', 'user@localhost']) {
      expect(maskText(text)).toBe(text);
    }
  });

  it('texte long et piégé : traité en temps borné (pas de retour arrière catastrophique)', () => {
    const traps = ['a'.repeat(25_000) + '@' + 'a-'.repeat(12_500) + '!', 'a@' + 'a.'.repeat(25_000) + '1'];
    for (const text of traps) {
      const start = performance.now();
      maskText(text);
      expect(performance.now() - start).toBeLessThan(1_000);
    }
  });

  it('majuscules, sous-domaines et punycode masqués', () => {
    for (const email of ['JEAN.DUPONT@EXEMPLE.EXAMPLE', 'a+b@sub.dom.example', 'x@xn--bcher-kva.example']) {
      expect(maskText(`pour ${email}.`)).toBe('pour [e-mail masqué].');
    }
  });

  it('breadcrumb : adresse masquée dans le message', () => {
    expect(scrubBreadcrumb({ category: 'console', message: `Mail envoyé à ${EMAILS[0]}` }).message).toBe('Mail envoyé à [e-mail masqué]');
  });
});

describe('scrubBreadcrumb (#746)', () => {
  it('retire la query string des appels sortants, garde URL, méthode et statut', () => {
    const crumb: Breadcrumb = {
      category: 'http',
      type: 'http',
      data: {
        url: 'https://financialmodelingprep.com/stable/quote',
        'http.method': 'GET',
        'http.query': `?symbol=ES&apikey=${FAKE.apiKey}`,
        status_code: 200,
      },
    };
    expect(scrubBreadcrumb(crumb).data).toEqual({
      url: 'https://financialmodelingprep.com/stable/quote',
      'http.method': 'GET',
      status_code: 200,
    });
  });

  it('masque l’identifiant client Stripe dans l’URL d’un appel sortant (#827)', () => {
    const crumb: Breadcrumb = {
      category: 'http',
      type: 'http',
      data: { url: 'https://api.stripe.com/v1/customers/cus_Fictif123', 'http.method': 'GET', status_code: 404 },
    };
    expect(scrubBreadcrumb(crumb).data).toEqual({
      url: 'https://api.stripe.com/v1/customers/cus_[masqué]',
      'http.method': 'GET',
      status_code: 404,
    });
  });

  it('breadcrumb sans données : inchangé', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' })).toEqual({ category: 'console', message: 'x' });
  });
});

describe('buildSentryOptions', () => {
  it('pas d’option dataCollection (elle repartirait de « tout collecter », IP comprise)', () => {
    const options = buildSentryOptions('https://cle@sentry.exemple.invalid/1', {});
    expect(options).not.toHaveProperty('dataCollection');
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(0);
  });
});

/**
 * SDK réel : vraie requête HTTP vers un serveur local instrumenté, événement capturé par un
 * transport en mémoire (rien ne sort de la machine). Prouve ce qui part, pas seulement ce que
 * fait la fonction de nettoyage.
 */
describe('SDK Sentry réel : ce qui part pour une 500 (#746)', () => {
  // Événements tels qu'ils partiraient vers Sentry (sortie du transport).
  const events: ErrorEvent[] = [];
  // Requête telle que le SDK l'a jointe, AVANT scrubEvent : prouve que le corps n'est plus lu.
  const rawRequests: ErrorEvent['request'][] = [];
  const transport = (): Transport => ({
    send: async (envelope: Envelope) => {
      for (const [header, payload] of envelope[1] as unknown as [{ type: string }, unknown][]) {
        if (header.type === 'event') events.push(payload as ErrorEvent);
      }
      return {};
    },
    flush: async () => true,
  });
  let api: Server;
  let upstream: Server;

  const listen = (server: Server) =>
    new Promise<number>((done) => server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)));

  beforeAll(async () => {
    const options = buildSentryOptions('https://cle@sentry.exemple.invalid/1', {});
    Sentry.init({
      ...options,
      transport,
      beforeSend: (event, hint) => {
        rawRequests.push(structuredClone(event.request));
        return options.beforeSend ? options.beforeSend(event, hint) : event;
      },
    });

    // Service externe fictif, appelé avec une clé d'API en query (comme FMP ou le calendrier éco).
    upstream = createServer((_req, res) => res.end('{}'));
    const upstreamPort = await listen(upstream);

    // Route qui lit le corps (comme body-parser), appelle le service externe puis lève une 500
    // signalée comme le fait HttpExceptionFilter.
    api = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        await fetch(`http://127.0.0.1:${upstreamPort}/quote?symbol=ES&apikey=${FAKE.apiKey}`);
        Sentry.captureException(new Error('Envoi refusé pour a@exemple.invalid'), {
          tags: { method: req.method ?? '', path: (req.url ?? '').split('?')[0] },
          user: { id: FAKE.userId },
        });
        res.statusCode = 500;
        res.end();
      });
    });
  });

  afterAll(async () => {
    await Sentry.close();
    api?.close();
    upstream?.close();
  });

  it('ni corps, ni cookies, ni Authorization, ni query string, ni clé d’API ; user.id et path gardés', async () => {
    const port = await listen(api);
    await fetch(`http://127.0.0.1:${port}/api/test-500?token=${FAKE.unsubscribeToken}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: FAKE.bearer,
        cookie: `refresh_token=${FAKE.refreshToken}`,
      },
      body: JSON.stringify({ email: 'a@exemple.invalid', password: FAKE.password }),
    });
    await Sentry.flush(2000);

    expect(events).toHaveLength(1);
    const [event] = events;

    const sent = JSON.stringify(event);
    for (const secret of [FAKE.password, FAKE.refreshToken, FAKE.bearer, FAKE.unsubscribeToken, FAKE.apiKey]) {
      expect(sent).not.toContain(secret);
    }
    // Adresse dans le message de l'erreur ET dans le corps (jamais envoyé) : masquée de bout en bout (#1263).
    expect(sent).not.toContain('a@exemple.invalid');
    expect(sent).toContain('Envoi refusé pour [e-mail masqué]');
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.url).toBe(`http://127.0.0.1:${port}/api/test-500`);
    expect(Object.keys(event.request?.headers ?? {})).not.toContain('authorization');
    expect(Object.keys(event.request?.headers ?? {})).not.toContain('cookie');
    expect(event.user).toEqual({ id: FAKE.userId });
    expect(event.tags).toMatchObject({ path: '/api/test-500' });
    // Le corps n'est même plus lu par le SDK (maxIncomingRequestBodySize: 'none').
    expect(rawRequests).toHaveLength(1);
    expect(rawRequests[0]?.data).toBeUndefined();
    // L'appel sortant reste visible (URL nue), sans sa query string.
    expect(event.breadcrumbs?.some((b) => b.category === 'http' && String(b.data?.['url']).endsWith('/quote'))).toBe(true);
  });
});
