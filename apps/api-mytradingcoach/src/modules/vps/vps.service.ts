import { BadGatewayException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/nestjs';
import { NodeSSH } from 'node-ssh';
import type { VpsStats } from '@mtc/shared';
import { ExpectedOutageException } from '../../common/exceptions/expected-outage.exception';
import { RedisService } from '../infra/redis.service';
import { VPS_READ_COMMANDS } from './vps-commands';
import { resolveVpsServer, type VpsServer, type VpsServerId } from './vps-servers';
export type { VpsStats };

/** Après un échec de connexion, plus aucune tentative SSH vers ce serveur pendant ce délai. */
export const VPS_RETRY_DELAY_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Panne déjà signalée à Sentry : clé partagée par tous les process (cluster web + worker). */
const downKey = (id: VpsServerId) => `vps:down:${id}`;
const DOWN_TTL_SEC = 7 * 24 * 3600;

/** Empreinte d'une clé d'hôte au format de `ssh-keygen -lf` : `SHA256:<base64 sans =>`. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** Raison lisible d'un échec de connexion SSH, affichée telle quelle dans l'admin. */
export function describeSshError(e: unknown): string {
  const err = (e ?? {}) as { message?: string; code?: string; level?: string };
  const msg = err.message ?? '';
  if (err.level === 'client-authentication' || /authentication methods failed/i.test(msg)) return 'authentification refusée';
  if (/verification failed|host denied/i.test(msg)) return "clé d'hôte inattendue";
  if (err.code === 'ECONNREFUSED') return 'connexion refusée';
  if (err.code === 'ETIMEDOUT' || /timed out/i.test(msg)) return 'délai dépassé';
  if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') return 'hôte injoignable';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'hôte introuvable';
  return 'erreur SSH';
}

@Injectable()
export class VpsService implements OnModuleDestroy {
  private readonly logger = new Logger(VpsService.name);
  // Une connexion SSH par serveur (principal / secondaire), ouverte à la demande.
  private readonly connections = new Map<VpsServerId, NodeSSH>();
  // Connexion en cours : stats et containers arrivent ensemble, une seule tentative pour les deux.
  private readonly connecting = new Map<VpsServerId, Promise<NodeSSH>>();
  // Dernier échec par serveur : l'erreur est rendue sans retenter SSH jusqu'à `until` (pas de
  // rafale d'échecs d'authentification, que le fail2ban d'en face finirait par bannir).
  private readonly failures = new Map<VpsServerId, { until: number; reason: string }>();
  // Repli si Redis ne répond pas : panne signalée par CE process.
  private readonly reportedDown = new Set<VpsServerId>();

  constructor(private readonly redis: RedisService) {}

  async getConnection(serverId?: VpsServerId): Promise<NodeSSH> {
    const server = resolveVpsServer(serverId);
    const current = this.connections.get(server.id);
    if (current?.isConnected()) return current;
    // Message testé par MetricsSnapshotCron (SSH non configuré ≠ incident).
    if (!server.keyB64) throw new Error('VPS_SSH_KEY_B64 non configurée');

    const failure = this.failures.get(server.id);
    if (failure && failure.until > Date.now()) throw this.unreachable(server, failure.reason, failure.until);

    let pending = this.connecting.get(server.id);
    if (!pending) {
      pending = this.connect(server).finally(() => this.connecting.delete(server.id));
      this.connecting.set(server.id, pending);
    }
    return pending;
  }

  /**
   * Exécute une commande et rend sa sortie standard. Un code de sortie non nul lève une erreur :
   * avant, `stdout || stderr` était rendu quoi qu'il arrive, et une commande refusée par le
   * serveur passait pour un succès (« container redémarré » alors que rien n'avait bougé).
   */
  async exec(cmd: string, serverId?: VpsServerId): Promise<string> {
    const server = resolveVpsServer(serverId);
    const ssh = await this.getConnection(server.id);
    const result = await ssh.execCommand(cmd);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).split('\n')[0]?.trim().slice(0, 200);
      throw new BadGatewayException({
        code: 'VPS_COMMAND_FAILED',
        message: `Commande en échec sur ${server.label} (code ${result.code ?? result.signal ?? '?'})${detail ? ` : ${detail}` : ''}`,
      });
    }
    return result.stdout;
  }

  async getStats(serverId?: VpsServerId): Promise<VpsStats> {
    const server = resolveVpsServer(serverId);
    const ssh = await this.getConnection(server.id);
    const c = VPS_READ_COMMANDS;

    const [loadAvg, memInfo, dfInfo, uptime, uname, nodever, dockerver, netdev] =
      await Promise.all([
        ssh.execCommand(c.loadAvg),
        ssh.execCommand(c.memInfo),
        ssh.execCommand(c.disk),
        ssh.execCommand(c.uptime),
        ssh.execCommand(c.kernel),
        ssh.execCommand(c.node),
        ssh.execCommand(c.docker),
        ssh.execCommand(c.network),
      ]);

    const load = parseFloat(loadAvg.stdout.split(' ')[0] || '0');
    const memLines = memInfo.stdout.split('\n');
    const getMemVal = (key: string) => {
      const line = memLines.find(l => l.startsWith(key));
      return line ? parseInt(line.split(/\s+/)[1]) * 1024 : 0;
    };
    const memTotal = getMemVal('MemTotal:');
    const memAvail = getMemVal('MemAvailable:');

    const dfParts = dfInfo.stdout.trim().split(/\s+/);
    const diskTotal = parseInt(dfParts[1] || '0');
    const diskUsed = parseInt(dfParts[2] || '0');

    const uptimeSec = parseFloat(uptime.stdout.split(' ')[0] || '0');

    const netParts = netdev.stdout.trim().split(/\s+/);
    const netRx = parseInt(netParts[1] || '0');
    const netTx = parseInt(netParts[9] || '0');

    return {
      cpu: Math.round(load * 100 / (require('os').cpus().length || 1)),
      ram: { used: memTotal - memAvail, total: memTotal },
      disk: { used: diskUsed, total: diskTotal },
      network: { up: netTx, down: netRx },
      uptime: Math.floor(uptimeSec),
      os: 'Ubuntu 24.04 LTS',
      kernel: uname.stdout.trim(),
      node: nodever.stdout.trim(),
      docker: dockerver.stdout.trim(),
      ip: server.host,
    };
  }

  private async connect(server: VpsServer): Promise<NodeSSH> {
    const ssh = new NodeSSH();
    const expectedHostKey = server.hostKeySha256;
    try {
      await ssh.connect({
        host: server.host,
        username: server.user,
        privateKey: Buffer.from(server.keyB64 ?? '', 'base64').toString('utf-8'),
        readyTimeout: CONNECT_TIMEOUT_MS,
        ...(expectedHostKey ? { hostVerifier: (key: Buffer) => hostKeyFingerprint(key) === expectedHostKey } : {}),
      });
    } catch (e) {
      ssh.dispose();
      const reason = describeSshError(e);
      const until = Date.now() + VPS_RETRY_DELAY_MS;
      this.failures.set(server.id, { until, reason });
      await this.reportDown(server, reason, e);
      throw this.unreachable(server, reason, until);
    }
    this.failures.delete(server.id);
    this.connections.set(server.id, ssh);
    await this.reportUp(server);
    return ssh;
  }

  private unreachable(server: VpsServer, reason: string, until: number): ExpectedOutageException {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return new ExpectedOutageException(
      'VPS_UNREACHABLE',
      `${server.label} injoignable en SSH (${reason}). Nouvel essai dans ${seconds} s.`,
    );
  }

  /** Une seule alerte Sentry par panne (passage joignable → injoignable), tous process confondus. */
  private async reportDown(server: VpsServer, reason: string, error: unknown): Promise<void> {
    let first = !this.reportedDown.has(server.id);
    this.reportedDown.add(server.id);
    try {
      first = (await this.redis.client.set(downKey(server.id), reason, 'EX', DOWN_TTL_SEC, 'NX')) === 'OK';
    } catch {
      // Redis indisponible : on garde la décision locale.
    }
    if (!first) return;
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.warn(`${server.label} injoignable en SSH : ${reason} (${detail})`);
    Sentry.captureMessage(`VPS injoignable en SSH : ${server.label}`, {
      level: 'warning',
      tags: { vps: server.id },
      extra: { reason, detail },
      fingerprint: ['vps-unreachable', server.id],
    });
  }

  private async reportUp(server: VpsServer): Promise<void> {
    let wasDown = this.reportedDown.delete(server.id);
    try {
      wasDown = (await this.redis.client.del(downKey(server.id))) > 0 || wasDown;
    } catch {
      // Redis indisponible : décision locale.
    }
    if (wasDown) this.logger.log(`${server.label} de nouveau joignable en SSH`);
  }

  onModuleDestroy() {
    for (const ssh of this.connections.values()) ssh.dispose();
  }
}
