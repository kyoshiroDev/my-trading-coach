import { Injectable } from '@nestjs/common';
import { VpsService } from './vps.service';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  cpu: number;
  ram: number;
  ramLimit: number;
  ports: string[];
}

@Injectable()
export class DockerService {
  constructor(private readonly vps: VpsService) {}

  async listContainers(): Promise<DockerContainer[]> {
    const psOutput = await this.vps.exec(
      `docker ps -a --format '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}"}'`,
    );

    const lines = psOutput.split('\n').filter(l => l.trim());
    const containers = lines.map(line => {
      try {
        const d = JSON.parse(line);
        const running = d.status?.toLowerCase().includes('up');
        const error   = d.status?.toLowerCase().includes('exit') && !running;
        return {
          id:       d.id,
          name:     d.name.replace(/^\//, ''),
          image:    d.image,
          status:   running ? 'running' : error ? 'error' : 'stopped',
          cpu:      0,
          ram:      0,
          ramLimit: 0,
          ports:    d.ports ? d.ports.split(', ').filter(Boolean) : [],
        } as DockerContainer;
      } catch { return null; }
    }).filter(Boolean) as DockerContainer[];

    const runningNames = containers
      .filter(c => c.status === 'running')
      .map(c => c.name)
      .join(' ');

    if (runningNames) {
      try {
        const statsOutput = await this.vps.exec(
          `docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' ${runningNames}`,
        );
        for (const line of statsOutput.split('\n').filter(l => l.trim())) {
          const [name, cpuStr, memStr] = line.split('|');
          if (!name || !cpuStr || !memStr) continue;
          const container = containers.find(c => c.name === name.trim());
          if (!container) continue;
          container.cpu      = parseFloat(cpuStr.replace('%', '').trim()) || 0;
          const memParts     = memStr.split('/');
          container.ram      = this.parseMemMB(memParts[0]?.trim() ?? '');
          container.ramLimit = this.parseMemMB(memParts[1]?.trim() ?? '');
        }
      } catch {
        // Si docker stats échoue, on garde cpu=0 ram=0
      }
    }

    return containers;
  }

  private parseMemMB(str: string): number {
    if (!str) return 0;
    const val = parseFloat(str);
    if (isNaN(val)) return 0;
    if (str.includes('GiB') || str.includes('GB')) return Math.round(val * 1024);
    if (str.includes('MiB') || str.includes('MB')) return Math.round(val);
    if (str.includes('KiB') || str.includes('KB')) return Math.round(val / 1024);
    return Math.round(val);
  }

  async containerAction(id: string, action: 'start' | 'stop' | 'restart') {
    await this.vps.exec(`docker ${action} ${id}`);
    return { success: true };
  }

  async deleteContainer(id: string) {
    await this.vps.exec(`docker rm -f ${id}`);
    return { success: true };
  }
}
