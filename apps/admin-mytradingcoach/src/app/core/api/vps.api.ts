import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface VpsStats {
  cpu: number; ram: { used: number; total: number };
  disk: { used: number; total: number }; network: { up: number; down: number };
  uptime: number; os: string; kernel: string; node: string; docker: string; ip: string;
}

export interface DockerContainer {
  id: string; name: string; image: string;
  status: 'running' | 'stopped' | 'error';
  cpu: number; ram: number; ramLimit: number; ports: string[];
}

export interface Backup {
  filename: string; size: number; createdAt: string; type: 'auto' | 'manual';
}

@Injectable({ providedIn: 'root' })
export class VpsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  stats()                      { return this.http.get<{ data: VpsStats }>(`${this.base}/vps/stats`); }
  containers()                 { return this.http.get<{ data: DockerContainer[] }>(`${this.base}/docker/containers`); }
  containerAction(id: string, action: 'start' | 'stop' | 'restart') {
    return this.http.post(`${this.base}/docker/containers/${id}/${action}`, {});
  }
  startContainer(id: string)   { return this.http.post(`${this.base}/docker/containers/${id}/start`, {}); }
  stopContainer(id: string)    { return this.http.post(`${this.base}/docker/containers/${id}/stop`, {}); }
  restartContainer(id: string) { return this.http.post(`${this.base}/docker/containers/${id}/restart`, {}); }
  deleteContainer(id: string)  { return this.http.delete(`${this.base}/docker/containers/${id}`); }
  backups()                    { return this.http.get<{ data: Backup[] }>(`${this.base}/vps/backups`); }
  createBackup()               { return this.http.post(`${this.base}/vps/backups`, {}); }
  deleteBackup(f: string)      { return this.http.delete(`${this.base}/vps/backups/${f}`); }
  logsUrl(container: string, token: string): string {
    return `${this.base}/vps/logs/${container}?token=${token}`;
  }
}
