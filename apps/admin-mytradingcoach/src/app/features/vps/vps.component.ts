import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, of } from 'rxjs';
import { catchError, startWith, switchMap } from 'rxjs/operators';
import { VpsApi, VpsStats } from '../../core/api/vps.api';

@Component({
  selector: 'mtc-admin-vps',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './vps.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">VPS / Serveur</h1>
        <span class="refresh-hint">Auto 10s</span>
      </div>
      @if (loading()) {
        <div class="empty-state">Connexion SSH au VPS...</div>
      } @else if (error()) {
        <div class="empty-state">
          <span>Module VPS non disponible</span>
          <span>Déployer le module NestJS VPS pour activer cette section.</span>
        </div>
      } @else if (stats(); as s) {
        <div class="two-col">
          <div class="card">
            <div class="card-header"><span class="card-title">Ressources système</span></div>
            <div class="metric-row">
              <span class="metric-label">CPU</span>
              <div class="metric-bar"><div class="metric-fill" [class.red]="s.cpu>80" [class.amber]="s.cpu>60&&s.cpu<=80" [class.teal]="s.cpu<=60" [style.width.%]="s.cpu"></div></div>
              <span class="metric-val">{{ s.cpu }}%</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">RAM</span>
              <div class="metric-bar"><div class="metric-fill blue" [style.width.%]="(s.ram.used/s.ram.total)*100"></div></div>
              <span class="metric-val">{{ (s.ram.used/1073741824) | number:'1.1-1' }}G / {{ (s.ram.total/1073741824) | number:'1.1-1' }}G</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Disque</span>
              <div class="metric-bar"><div class="metric-fill amber" [style.width.%]="(s.disk.used/s.disk.total)*100"></div></div>
              <span class="metric-val">{{ (s.disk.used/1073741824) | number:'1.0-0' }}G / {{ (s.disk.total/1073741824) | number:'1.0-0' }}G</span>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Informations</span></div>
            <div class="info-row"><span class="info-label">IP</span><span class="info-val">{{ s.ip }}</span></div>
            <div class="info-row"><span class="info-label">OS</span><span class="info-val">{{ s.os }}</span></div>
            <div class="info-row"><span class="info-label">Kernel</span><span class="info-val">{{ s.kernel }}</span></div>
            <div class="info-row"><span class="info-label">Node</span><span class="info-val">{{ s.node }}</span></div>
            <div class="info-row"><span class="info-label">Docker</span><span class="info-val">{{ s.docker }}</span></div>
            <div class="info-row"><span class="info-label">Uptime</span><span class="info-val">{{ formatUptime(s.uptime) }}</span></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class VpsComponent {
  private readonly vpsApi = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly stats = signal<VpsStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  constructor() {
    interval(10_000).pipe(
      startWith(0),
      switchMap(() =>
        this.vpsApi.stats().pipe(
          catchError(() => {
            this.error.set(true);
            return of(null);
          }),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => {
      if (r) this.stats.set(r.data);
      this.loading.set(false);
    });
  }

  protected formatUptime(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d > 0 ? `${d}j ${h}h` : `${h}h`;
  }
}
