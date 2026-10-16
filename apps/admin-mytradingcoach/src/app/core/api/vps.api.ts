import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@admin/environments/environment';
import type { VpsStats } from '@mtc/shared';
export type { VpsStats };

export interface DockerContainer {
  id: string; name: string; image: string;
  status: 'running' | 'stopped' | 'error';
  cpu: number; ram: number; ramLimit: number; ports: string[];
}

/** Serveur joignable en SSH par l'API (`principal` = VPS_HOST, `secondaire` = VPS_SECONDARY_HOST). */
export type VpsServerId = 'principal' | 'secondaire';
/** `readOnly` : stats et containers seulement (secondaire) ; actions et logs refusés par l'API. */
export interface VpsServer { id: VpsServerId; label: string; readOnly: boolean; }

export interface Backup {
  filename: string;
  sizeMb: number;
  createdAt: string;
  type: 'auto' | 'manual';
  target: 'bdd_prod' | 'bdd_dev' | 'bdd_beta' | 'api_prod' | 'api_dev';
}

export interface HealthPoint {
  date: string;
  status: 'ok' | 'incident' | 'unknown';
}

@Injectable({ providedIn: 'root' })
export class VpsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  servers()     { return this.http.get<{ data: VpsServer[] }>(`${this.base}/vps/servers`); }
  stats(server: VpsServerId = 'principal') {
    return this.http.get<{ data: VpsStats }>(`${this.base}/vps/stats`, { params: { server } });
  }
  healthHistory(days = 90) { return this.http.get<{ data: HealthPoint[] }>(`${this.base}/admin/health-history?days=${days}`); }
  containers(server: VpsServerId = 'principal') {
    return this.http.get<{ data: DockerContainer[] }>(`${this.base}/docker/containers`, { params: { server } });
  }
  containerAction(id: string, action: 'start' | 'stop' | 'restart', server: VpsServerId = 'principal') {
    return this.http.post(`${this.base}/docker/containers/${id}/${action}`, {}, { params: { server } });
  }
  startContainer(id: string)   { return this.http.post(`${this.base}/docker/containers/${id}/start`, {}); }
  stopContainer(id: string)    { return this.http.post(`${this.base}/docker/containers/${id}/stop`, {}); }
  restartContainer(id: string) { return this.http.post(`${this.base}/docker/containers/${id}/restart`, {}); }
  deleteContainer(id: string)  { return this.http.delete(`${this.base}/docker/containers/${id}`); }

  listBackups() { return this.http.get<{ data: Backup[] }>(`${this.base}/vps/backups`); }
  createBackup(target: 'bdd_prod' | 'bdd_dev' | 'bdd_beta' | 'api_prod' | 'api_dev') {
    return this.http.post<{ data: Backup }>(`${this.base}/vps/backups`, { target });
  }
  restoreBackup(filename: string) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.base}/vps/backups/${filename}/restore`, {},
    );
  }
  deleteBackup(f: string) { return this.http.delete(`${this.base}/vps/backups/${f}`); }

  logsUrl(container: string, token: string, server: VpsServerId = 'principal'): string {
    return `${this.base}/vps/logs/${container}?token=${token}&server=${server}`;
  }
}
