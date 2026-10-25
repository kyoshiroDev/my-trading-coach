import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { generateVAPIDKeys } from 'web-push';
import { PUSH_DEADLINE_MS, PUSH_MAX_RESPONSE_BYTES, PushDeadlineError, postWithLimits } from './push-http';
import { WebPushLibSender } from './push-sender';

/**
 * Revue #717, I2 : un service push malveillant ou défaillant ne doit ni tenir une requête ouverte
 * au-delà du délai total, ni remplir la mémoire. Faux serveur HTTPS LOCAL (certificat jetable).
 */

let server: Server;
let base: string;
let ca: Buffer;
let dir: string;
const hits: string[] = [];
const received: { headers: Record<string, unknown>; bytes: number }[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'push-http-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'),
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  ca = readFileSync(join(dir, 'c.pem'));
  server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: ca }, (req, res) => {
    hits.push(req.url ?? '');
    let bytes = 0;
    req.on('data', (c: Buffer) => { bytes += c.length; });
    req.on('end', () => {
      received.push({ headers: req.headers, bytes });
      if (req.url === '/redirect') { res.writeHead(302, { location: `${base}/after` }); res.end(); return; }
      if (req.url === '/silent') return; // jamais de réponse
      if (req.url === '/drip') {
        res.writeHead(201);
        const t = setInterval(() => res.write('x'), 100);
        res.on('close', () => clearInterval(t));
        return;
      }
      if (req.url === '/stream') {
        res.writeHead(201);
        const t = setInterval(() => res.write(Buffer.alloc(4096, 'b')), 20);
        res.on('close', () => clearInterval(t));
        return;
      }
      if (req.url === '/big') { res.writeHead(201); res.end(Buffer.alloc(5 * 1024 * 1024, 'a')); return; }
      res.writeHead(201);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `https://localhost:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const limits = () => ({ deadlineMs: 800, maxResponseBytes: 1024, tls: { ca } });
const post = (path: string) => postWithLimits({ endpoint: `${base}${path}`, method: 'POST', headers: {}, body: Buffer.from('{}') }, limits());

describe('postWithLimits', () => {
  it('réponse normale : code HTTP rendu', async () => {
    expect(await post('/ok')).toBe(201);
  });

  it('réponse qui ne finit jamais (un octet toutes les 100 ms) : coupée au délai total', async () => {
    const t0 = Date.now();
    expect(await post('/drip')).toBe(201);
    // Coupée au plafond (1 Ko, ~10 s ici) ou à l'échéance (800 ms) : jamais au-delà de l'échéance.
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('aucune réponse : rejetée à l’échéance, pas après', async () => {
    const t0 = Date.now();
    // Classe dédiée : `deliverPush` la journalise « délai dépassé », pas « erreur réseau ».
    await expect(post('/silent')).rejects.toBeInstanceOf(PushDeadlineError);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('corps de 5 Mo : lecture arrêtée au plafond', async () => {
    const t0 = Date.now();
    expect(await post('/big')).toBe(201);
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('flux sans fin de 4 Ko toutes les 20 ms : coupé au plafond, bien avant l’échéance (revue M14)', async () => {
    const t0 = Date.now();
    expect(await post('/stream')).toBe(201);
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it('redirection : rendue telle quelle, jamais suivie', async () => {
    const before = hits.length;
    expect(await post('/redirect')).toBe(302);
    await new Promise((r) => setTimeout(r, 100));
    expect(hits.slice(before)).toEqual(['/redirect']);
  });
});

describe('limites de production (revue #717, I2)', () => {
  it('délai total 10 s, réponse lue jusqu’à 16 Ko, appliqués par défaut à l’envoi réel', () => {
    expect(PUSH_DEADLINE_MS).toBe(10_000);
    expect(PUSH_MAX_RESPONSE_BYTES).toBe(16 * 1024);
    const sender = new WebPushLibSender({ ...generateVAPIDKeys(), subject: 'mailto:test@example.com' });
    expect((sender as unknown as { limits: unknown }).limits).toEqual({ deadlineMs: 10_000, maxResponseBytes: 16 * 1024 });
  });
});

describe('WebPushLibSender', () => {
  const vapid = { ...generateVAPIDKeys(), subject: 'mailto:test@example.com' };
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const target = (endpoint: string) => ({ endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') });

  it('adresse hors liste blanche : refusée avant toute connexion', async () => {
    const sender = new WebPushLibSender(vapid);
    const before = hits.length;
    await expect(sender.send(target(`${base}/ok`), '{"title":"t"}', { ttlSeconds: 60, urgency: 'normal' })).rejects.toThrow(/non autorisé/);
    expect(hits.length).toBe(before);
  });

  it('envoi chiffré aes128gcm et signé VAPID, par le transport borné', async () => {
    const sender = new WebPushLibSender(vapid, limits(), () => true);
    expect(await sender.send(target(`${base}/ok`), '{"title":"t"}', { ttlSeconds: 60, urgency: 'high' })).toBe(201);
    const last = received[received.length - 1];
    expect(last.headers).toMatchObject({ 'content-encoding': 'aes128gcm', ttl: '60', urgency: 'high' });
    expect(String(last.headers['authorization'])).toMatch(/^vapid t=/);
    expect(last.bytes).toBeGreaterThan(0);
  });
});
