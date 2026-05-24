import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';

export interface VpsStats {
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: number; total: number };
  network: { up: number; down: number };
  uptime: number;
  os: string;
  kernel: string;
  node: string;
  docker: string;
  ip: string;
}

@Injectable()
export class VpsService implements OnModuleDestroy {
  private readonly logger = new Logger(VpsService.name);
  private ssh: NodeSSH | null = null;

  async getConnection(): Promise<NodeSSH> {
    if (this.ssh?.isConnected()) return this.ssh;
    const ssh = new NodeSSH();
    const keyB64 = process.env['VPS_SSH_KEY_B64'];
    if (!keyB64) throw new Error('VPS_SSH_KEY_B64 non configurée');
    const privateKey = Buffer.from(keyB64, 'base64').toString('utf-8');
    await ssh.connect({
      host: process.env['VPS_HOST'] ?? '51.83.197.230',
      username: process.env['VPS_USER'] ?? 'greg',
      privateKey,
    });
    this.ssh = ssh;
    return ssh;
  }

  async exec(cmd: string): Promise<string> {
    const ssh = await this.getConnection();
    const result = await ssh.execCommand(cmd);
    return result.stdout || result.stderr;
  }

  async getStats(): Promise<VpsStats> {
    const ssh = await this.getConnection();

    const [loadAvg, memInfo, dfInfo, uptime, uname, nodever, dockerver, netdev] =
      await Promise.all([
        ssh.execCommand('cat /proc/loadavg'),
        ssh.execCommand('cat /proc/meminfo'),
        ssh.execCommand("df -B1 / | tail -1"),
        ssh.execCommand('cat /proc/uptime'),
        ssh.execCommand('uname -r'),
        ssh.execCommand('node -v 2>/dev/null || echo n/a'),
        ssh.execCommand("docker -v 2>/dev/null | awk '{print $3}' | tr -d ',' || echo n/a"),
        ssh.execCommand("cat /proc/net/dev | grep -E 'eth0|ens' | head -1"),
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
      ip: process.env['VPS_HOST'] ?? '51.83.197.230',
    };
  }

  onModuleDestroy() {
    this.ssh?.dispose();
  }
}
