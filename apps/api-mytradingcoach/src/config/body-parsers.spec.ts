import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureBodyParsers, STRIPE_WEBHOOK_PATH } from './body-parsers';

/** Vrai serveur Express, configuré comme l'API (seule différence : pas de Nest autour). */
const ex = express();
const fakeApp = {
  use: (...args: Parameters<typeof ex.use>) => ex.use(...args),
  useBodyParser: (type: 'json' | 'urlencoded', opts?: object) => ex.use(express[type](opts)),
} as unknown as NestExpressApplication;
configureBodyParsers(fakeApp);
type Echo = { body: unknown; raw: string | null };
const echo = (req: express.Request, res: express.Response) =>
  res.json({ body: req.body, raw: (req as unknown as { rawBody?: Buffer }).rawBody?.toString() ?? null });
ex.post(STRIPE_WEBHOOK_PATH, echo);
ex.post('/api/trades', echo);
ex.post('/api/form', echo);

let server: Server;
const url = async (path: string) => {
  if (!server) await new Promise<void>((r) => (server = ex.listen(0, '127.0.0.1', () => r())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
};
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('configureBodyParsers (SCA-B3-06)', () => {
  it('webhook Stripe : JSON parsé ET octets bruts exacts (signature)', async () => {
    const payload = '{"id":"evt_1",  "type":"invoice.paid"}'; // espaces conservés : la signature porte dessus
    const r = await (await fetch(await url(STRIPE_WEBHOOK_PATH), { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })).json() as Echo;
    expect(r.raw).toBe(payload);
    expect(r.body).toEqual({ id: 'evt_1', type: 'invoice.paid' });
  });

  it('autres routes JSON : corps parsé, AUCUNE copie brute', async () => {
    const r = await (await fetch(await url('/api/trades'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"asset":"NQ"}' })).json() as Echo;
    expect(r.body).toEqual({ asset: 'NQ' });
    expect(r.raw).toBeNull();
  });

  it('formulaires (urlencoded) toujours lus', async () => {
    const r = await (await fetch(await url('/api/form'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1&b[c]=2' })).json() as Echo;
    expect(r.body).toEqual({ a: '1', b: { c: '2' } });
  });
});
