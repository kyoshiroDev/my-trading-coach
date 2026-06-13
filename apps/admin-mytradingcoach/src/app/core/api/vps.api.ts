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
  filename: string;
  sizeMb: number;
  createdAt: string;
  type: 'auto' | 'manual';
  target: 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev';
}

export interface HealthPoint {
  date: string;
  status: 'ok' | 'incident' | 'unknown';
}

@Injectable({ providedIn: 'root' })
export class VpsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  stats()       { return this.http.get<{ data: VpsStats }>(`${this.base}/vps/stats`); }
  healthHistory(days = 90) { return this.http.get<{ data: HealthPoint[] }>(`${this.base}/admin/health-history?days=${days}`); }
  containers()  { return this.http.get<{ data: DockerContainer[] }>(`${this.base}/docker/containers`); }
  containerAction(id: string, action: 'start' | 'stop' | 'restart') {
    return this.http.post(`${this.base}/docker/containers/${id}/${action}`, {});
  }
  startContainer(id: string)   { return this.http.post(`${this.base}/docker/containers/${id}/start`, {}); }
  stopContainer(id: string)    { return this.http.post(`${this.base}/docker/containers/${id}/stop`, {}); }
  restartContainer(id: string) { return this.http.post(`${this.base}/docker/containers/${id}/restart`, {}); }
  deleteContainer(id: string)  { return this.http.delete(`${this.base}/docker/containers/${id}`); }

  listBackups() { return this.http.get<{ data: Backup[] }>(`${this.base}/vps/backups`); }
  createBackup(target: 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev') {
    return this.http.post<{ data: Backup }>(`${this.base}/vps/backups`, { target });
  }
  restoreBackup(filename: string) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.base}/vps/backups/${filename}/restore`, {},
    );
  }
  deleteBackup(f: string) { return this.http.delete(`${this.base}/vps/backups/${f}`); }

  logsUrl(container: string, token: string): string {
    return `${this.base}/vps/logs/${container}?token=${token}`;
  }
}
