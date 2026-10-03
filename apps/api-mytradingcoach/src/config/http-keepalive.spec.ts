import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { applyKeepAlive, KEEP_ALIVE_TIMEOUT_MS, HEADERS_TIMEOUT_MS, TRAEFIK_IDLE_CONN_TIMEOUT_MS } from './http-keepalive';

describe('applyKeepAlive (#301 — 502 sporadiques derrière Traefik)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it('Node garde la connexion plus longtemps que Traefik, headersTimeout au-dessus', () => {
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(TRAEFIK_IDLE_CONN_TIMEOUT_MS);
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('appliqué à un vrai serveur HTTP, et annoncé au client (Keep-Alive: timeout=95)', async () => {
    server = createServer((_req, res) => res.end('ok'));
    applyKeepAlive(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    const keepAlive = await new Promise<string | undefined>((resolve, reject) => {
      request({ port, host: '127.0.0.1', headers: { connection: 'keep-alive' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.headers['keep-alive'] as string | undefined));
      }).on('error', reject).end();
    });
    expect(keepAlive).toBe(`timeout=${KEEP_ALIVE_TIMEOUT_MS / 1000}`);
  });
});
