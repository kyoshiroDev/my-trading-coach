import { Injectable, NotFoundException } from '@nestjs/common';
import { VpsService } from './vps.service';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  cpu: number;
  ram: number;
  ports: string[];
}

@Injectable()
export class DockerService {
  constructor(private readonly vps: VpsService) {}

  async listContainers(): Promise<DockerContainer[]> {
    const output = await this.vps.exec(
      'docker ps -a --format \'{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","ports":"{{.Ports}}"}\'',
    );
    const lines = output.split('\n').filter(l => l.trim());
    return lines.map(line => {
      try {
        const d = JSON.parse(line);
        const running = d.status?.toLowerCase().includes('up');
        const error = d.status?.toLowerCase().includes('exit') && !running;
        return {
          id: d.id,
          name: d.name.replace(/^\//, ''),
          image: d.image,
          status: running ? 'running' : error ? 'error' : 'stopped',
          cpu: 0,
          ram: 0,
          ports: d.ports ? d.ports.split(', ').filter(Boolean) : [],
        } as DockerContainer;
      } catch {
        return null;
      }
    }).filter(Boolean) as DockerContainer[];
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
