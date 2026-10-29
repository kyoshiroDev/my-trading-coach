/**
 * Coût d'une veille serveur (#770) : N WebSockets Tradovate ouverts et INACTIFS (le cas d'une veille :
 * heartbeat toutes les 2,5 s, aucun trade), avec la vraie classe `TradovateLiveConnection` et le
 * WebSocket natif de Node, comme l'API. Tradovate est simulé par un serveur local lancé dans un
 * AUTRE process : seul le coût côté API est mesuré. Aucun appel réseau sortant.
 *
 *   ulimit -n 65535 && pnpm exec tsx tools/load/veille-ws-bench.ts 0,500,1000,2000 [secondes]
 *
 * Sortie : par palier, CPU moyen du process (% d'un cœur) et mémoire (RSS) au-dessus du palier 0.
 * Le renouvellement du bail Redis (1 commande / 10 s / veille) n'est pas compté : négligeable.
 */
import { fork } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { TradovateLiveConnection } from '../../apps/api-mytradingcoach/src/modules/integrations/tradovate/tradovate-live.connection';

const PORT = 18_770;
const RAMP_MS = 15_000;

function server(): void {
  const wss = new WebSocketServer({ port: PORT });
  /** Connexions souscrites (autorisées PUIS syncrequest reçue) et heartbeats reçus des clients. */
  let subscribed = 0;
  let heartbeats = 0;
  process.on('message', () => process.send?.({ open: wss.clients.size, subscribed, heartbeats }));
  wss.on('connection', (ws) => {
    ws.send('o');
    ws.on('close', () => subscribed--);
    ws.on('message', (raw) => {
      const msg = String(raw);
      if (msg === '[]') heartbeats++;
      else if (msg.startsWith('authorize\n')) ws.send('a[{"s":200,"i":0}]');
      else if (msg.startsWith('user/syncrequest\n') && ++subscribed) ws.send('a[{"s":200,"i":1,"d":{"cashBalances":[],"positions":[],"orders":[],"orderVersions":[]}}]');
    });
  });
  // Comme Tradovate : une trame de vie toutes les 2,5 s sur chaque connexion.
  setInterval(() => wss.clients.forEach((c) => c.send('h')), 2_500);
  wss.on('listening', () => process.send?.({ ready: true }));
}

function stats(child: ReturnType<typeof fork>): Promise<{ open: number; subscribed: number; heartbeats: number }> {
  return new Promise((r) => {
    child.once('message', (m) => r(m as { open: number; subscribed: number; heartbeats: number }));
    child.send('stats');
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function measure(seconds: number): Promise<{ cpu: number; rss: number }> {
  const t0 = process.hrtime.bigint();
  const c0 = process.cpuUsage();
  await sleep(seconds * 1000);
  const c = process.cpuUsage(c0);
  const wallUs = Number(process.hrtime.bigint() - t0) / 1000;
  return { cpu: ((c.user + c.system) / wallUs) * 100, rss: process.memoryUsage().rss / 1024 / 1024 };
}

async function client(levels: number[], seconds: number): Promise<void> {
  const child = fork(process.argv[1], ['server'], { execArgv: process.execArgv });
  await new Promise<void>((r) => child.once('message', () => r()));
  const conns: TradovateLiveConnection[] = [];
  let base: { cpu: number; rss: number } | null = null;
  const rows: string[] = [];
  for (const n of levels) {
    const add = n - conns.length;
    for (let i = 0; i < add; i++) {
      const c = new TradovateLiveConnection({
        url: `ws://127.0.0.1:${PORT}/v1/websocket`,
        externalAccountId: 777,
        getToken: async () => 'jeton-de-banc',
        onTradeEvent: () => undefined,
      });
      conns.push(c);
      c.start();
      await sleep(RAMP_MS / Math.max(add, 1));
    }
    await sleep(5_000);
    global.gc?.();
    const before = await stats(child);
    const m = await measure(seconds);
    const after = await stats(child);
    base ??= m;
    // Contrôle : sans connexions réellement souscrites et vivantes, la mesure ne vaut rien.
    const hbPerConn = after.subscribed ? (after.heartbeats - before.heartbeats) / after.subscribed / seconds : 0;
    rows.push(
      `${String(n).padStart(6)} veilles · CPU ${m.cpu.toFixed(1).padStart(5)} % d'un cœur · RSS ${m.rss.toFixed(0).padStart(5)} Mo (+${(m.rss - base.rss).toFixed(0)} Mo)` +
        ` · souscrites ${after.subscribed}/${after.open} · heartbeat ${hbPerConn ? (1 / hbPerConn).toFixed(1) : '-'} s`,
    );
    console.log(rows[rows.length - 1]);
  }
  conns.forEach((c) => c.stop());
  child.kill();
  process.exit(0);
}

if (process.argv[2] === 'server') server();
else {
  const levels = (process.argv[2] ?? '0,500,1000,2000').split(',').map(Number);
  void client(levels, Number(process.argv[3] ?? 30));
}
