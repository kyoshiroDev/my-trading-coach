import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { VpsService } from './vps.service';
import { VPS_READ_COMMANDS } from './vps-commands';
import { resolveVpsServer, type VpsServerId } from './vps-servers';

// Id ou nom de container docker : rien d'autre ne doit arriver dans la commande SSH.
const CONTAINER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
// Nom de container pour `docker logs` : commence par un caractère alphanumérique, jamais un tiret.
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  cpu: number; // % CPU réel (docker stats)
  ram: number; // Mo utilisés réels (docker stats)
  ramLimit: number; // Mo limite (docker stats MemUsage "used / limit")
  ports: string[];
}

@Injectable()
export class DockerService {
  constructor(private readonly vps: VpsService) {}

  async listContainers(serverId?: VpsServerId): Promise<DockerContainer[]> {
    // 2 commandes : la liste complète (docker ps -a, inclut les arrêtés) + les stats
    // live (docker stats, uniquement les running). On fusionne par nom de container.
    const [psOut, statsOut] = await Promise.all([
      this.vps.exec(VPS_READ_COMMANDS.dockerPs, serverId),
      this.vps.exec(VPS_READ_COMMANDS.dockerStats, serverId).catch(() => ''),
    ]);

    // name -> { cpu %, ram Mo, ramLimit Mo }
    const statsByName = new Map<string, { cpu: number; ram: number; ramLimit: number }>();
    for (const line of statsOut.split('\n')) {
      const [name, cpuStr, memStr] = line.split('\t');
      if (!name || !memStr) continue;
      const [usedStr, limitStr] = memStr.split('/');
      statsByName.set(name.trim(), {
        cpu: parseFloat((cpuStr ?? '').replace('%', '').trim()) || 0,
        ram: this.toMb(usedStr ?? ''),
        ramLimit: this.toMb(limitStr ?? ''),
      });
    }

    const lines = psOut.split('\n').filter(l => l.trim());
    return lines.map(line => {
      try {
        const d = JSON.parse(line);
        const s = d.status?.toLowerCase() ?? '';
        const isUp = s.includes('up');
        const isUnhealthy = s.includes('unhealthy');
        const isExited = s.includes('exit');
        const status = (isExited && !isUp) || isUnhealthy ? 'error' : isUp ? 'running' : 'stopped';
        const name = d.name.replace(/^\//, '');
        const st = statsByName.get(name) ?? { cpu: 0, ram: 0, ramLimit: 0 };
        return {
          id: d.id,
          name,
          image: d.image,
          status,
          cpu: st.cpu,
          ram: st.ram,
          ramLimit: st.ramLimit,
          ports: d.ports ? d.ports.split(', ').filter(Boolean) : [],
        } as DockerContainer;
      } catch {
        return null;
      }
    }).filter(Boolean) as DockerContainer[];
  }

  /** Convertit une taille docker ("45.2MiB", "1.5GiB", "512B") en Mo (1 décimale). */
  private toMb(raw: string): number {
    const m = raw.trim().match(/^([\d.]+)\s*([A-Za-z]*)$/);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    const unit = (m[2] || 'B').toUpperCase();
    const factor: Record<string, number> = {
      B: 1 / 1_048_576, KB: 1 / 1000, KIB: 1 / 1024,
      MB: 1, MIB: 1, GB: 1000, GIB: 1024, TB: 1_000_000, TIB: 1_048_576,
    };
    return Math.round(val * (factor[unit] ?? 1) * 10) / 10;
  }

  async containerAction(id: string, action: 'start' | 'stop' | 'restart', serverId?: VpsServerId) {
    this.assertFullAccess(serverId);
    await this.vps.exec(`docker ${action} ${this.containerRef(id)}`, serverId);
    return { success: true };
  }

  async deleteContainer(id: string, serverId?: VpsServerId) {
    this.assertFullAccess(serverId);
    await this.vps.exec(`docker rm -f ${this.containerRef(id)}`, serverId);
    return { success: true };
  }

  /** Serveur en lecture seule (secondaire) : actions et logs refusés AVANT tout appel SSH. */
  assertFullAccess(serverId?: VpsServerId): void {
    const server = resolveVpsServer(serverId);
    if (server.readOnly) {
      throw new ForbiddenException({
        code: 'VPS_READ_ONLY',
        message: `${server.label} est en lecture seule : action impossible depuis l'admin.`,
      });
    }
  }

  /** Nom accepté par le flux de logs, sinon 400 (avant toute connexion SSH). */
  logsContainerName(name: string): string {
    if (!CONTAINER_NAME.test(name)) throw new BadRequestException('Container invalide');
    return name;
  }

  private containerRef(id: string): string {
    if (!CONTAINER_REF.test(id)) throw new BadRequestException('Container invalide');
    return id;
  }
}
