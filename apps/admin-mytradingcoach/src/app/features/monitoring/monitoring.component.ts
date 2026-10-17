import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  OnDestroy, computed, inject, signal, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';
import { apiErrorMessage } from '@mtc/shared';
import {
  LucideDynamicIcon,
  LucidePlay as Play,
  LucidePause as Pause,
  LucideTrash2 as Trash2,
  LucideRefreshCw as RefreshCw,
} from '@lucide/angular';
import { VpsApi, VpsStats, DockerContainer, HealthPoint, VpsServer, VpsServerId } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { DialogDirective } from '@mtc/front-ui';
import { visiblePoll, type PollResult } from '../../core/utils/visible-poll';

type DockerAction = 'start' | 'stop' | 'restart';
interface CtAction { icon: string; label: string; action: DockerAction; danger?: boolean; }
interface ConfirmState { id: string; name: string; action: DockerAction; server: VpsServerId; serverLabel: string; }

const GB = 1_073_741_824;
const POLL_MS = 15_000;

/** Code machine d'une erreur API (`{ code }` du filtre global), s'il y en a un. */
function apiErrorCode(err: unknown): string | undefined {
  const code = (err as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

@Component({
  selector: 'mtc-admin-monitoring',
  imports: [DialogDirective, DecimalPipe, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './monitoring.component.css',
  templateUrl: './monitoring.component.html',
})
export class MonitoringComponent implements OnDestroy {
  private readonly vpsApi = inject(VpsApi);
  private readonly auth = inject(AdminAuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly terminalRef = viewChild<ElementRef<HTMLDivElement>>('terminal');

  protected readonly PlayIcon = Play;
  protected readonly PauseIcon = Pause;
  protected readonly TrashIcon = Trash2;
  protected readonly RefreshIcon = RefreshCw;

  // Serveur affiché (stats, containers, logs, actions) : principal = VPS prod, secondaire = dev · beta.
  protected readonly servers = signal<VpsServer[]>([]);
  protected readonly server = signal<VpsServerId>('principal');
  protected readonly serverLabel = computed(
    () => this.servers().find((s) => s.id === this.server())?.label ?? 'VPS',
  );
  // Secondaire (dev · beta) : lecture seule, l'API refuse actions et logs → boutons masqués.
  protected readonly readOnly = computed(
    () => this.servers().find((s) => s.id === this.server())?.readOnly ?? false,
  );
  // Raison de l'indisponibilité du serveur affiché (503 VPS_UNREACHABLE), affichée en bandeau.
  protected readonly unreachable = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly stats = signal<VpsStats | null>(null);
  protected readonly allContainers = signal<DockerContainer[]>([]);
  protected readonly health = signal<HealthPoint[]>([]);
  protected readonly loadingStats = signal(true);
  protected readonly loadingContainers = signal(true);

  // Confirmation + drawer logs
  protected readonly confirmState = signal<ConfirmState | null>(null);
  protected readonly acting = signal(false);
  protected readonly logsContainer = signal<{ name: string; server: VpsServerId } | null>(null);
  protected readonly lines = signal<string[]>([]);
  protected readonly paused = signal(false);
  private es: EventSource | null = null;

  protected readonly runningCount = computed(() => this.allContainers().filter((c) => c.status === 'running').length);
  protected readonly ramPct = computed(() => this.pct(this.stats()?.ram));
  protected readonly diskPct = computed(() => this.pct(this.stats()?.disk));
  protected readonly netWidth = computed(() => Math.min(100, (this.stats()?.network.up ?? 0) / 1024 / 30));
  protected readonly cpuColor = computed(() => this.threshold(this.stats()?.cpu ?? 0));
  protected readonly allUnknown = computed(() => this.health().length > 0 && this.health().every((h) => h.status === 'unknown'));

  constructor() {
    this.vpsApi.servers().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.servers.set(r.data ?? []); });

    // Le polling repart de zéro à chaque changement de serveur ; rien onglet caché, et de plus en
    // plus espacé tant que le serveur ne répond pas (visiblePoll).
    const server$ = toObservable(this.server);
    server$.pipe(
      switchMap((srv) => visiblePoll(() => this.vpsApi.stats(srv), { periodMs: POLL_MS })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { this.loadingStats.set(false); this.onStats(r); });

    server$.pipe(
      switchMap((srv) => visiblePoll(() => this.vpsApi.containers(srv), { periodMs: POLL_MS })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { this.loadingContainers.set(false); this.onContainers(r); });

    this.vpsApi.healthHistory(90).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.health.set(r.data ?? []); });
  }

  protected selectServer(id: VpsServerId): void {
    if (id === this.server()) return;
    this.stats.set(null);
    this.allContainers.set([]);
    this.unreachable.set(null);
    this.loadingStats.set(true);
    this.loadingContainers.set(true);
    this.server.set(id);
  }

  protected refresh(): void {
    const srv = this.server();
    this.loadingStats.set(true);
    this.vpsApi.stats(srv).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => { this.loadingStats.set(false); this.onStats({ ok: true, value }); },
        error: (error: unknown) => { this.loadingStats.set(false); this.onStats({ ok: false, error }); },
      });
    this.vpsApi.containers(srv).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => this.onContainers({ ok: true, value }),
        error: (error: unknown) => this.onContainers({ ok: false, error }),
      });
  }

  private onStats(r: PollResult<{ data: VpsStats }>): void {
    if (r.ok) {
      this.unreachable.set(null);
      this.stats.set(r.value.data);
    } else if (this.markUnreachable(r.error)) {
      this.stats.set(null);
    }
  }

  private onContainers(r: PollResult<{ data: DockerContainer[] }>): void {
    if (r.ok) {
      this.unreachable.set(null);
      this.allContainers.set(r.value.data ?? []);
    } else if (this.markUnreachable(r.error)) {
      this.allContainers.set([]);
    }
  }

  /** 503 VPS_UNREACHABLE → bandeau avec la raison donnée par l'API ; les autres erreurs sont ignorées. */
  private markUnreachable(err: unknown): boolean {
    if (apiErrorCode(err) !== 'VPS_UNREACHABLE') return false;
    this.unreachable.set(apiErrorMessage(err, `${this.serverLabel()} injoignable en SSH.`));
    return true;
  }

  // ── Actions par type de container (logs toujours dispo, rendu à part) ──────
  protected actionsFor(c: DockerContainer): CtAction[] {
    const n = c.name.toLowerCase();
    // DB & proxy : on ne propose pas le "stop" en un geste (trop critique), juste redémarrer.
    if (n.includes('postgres') || n.includes('pgbouncer') || n.includes('redis') || n.includes('traefik')) {
      return [{ icon: '↻', label: 'Redémarrer', action: 'restart' }];
    }
    return [
      { icon: '↻', label: 'Redémarrer', action: 'restart' },
      { icon: '⏹', label: 'Arrêter', action: 'stop', danger: true },
    ];
  }

  protected askConfirm(c: DockerContainer, action: DockerAction): void {
    this.actionError.set(null);
    this.confirmState.set({ id: c.id, name: c.name, action, server: this.server(), serverLabel: this.serverLabel() });
  }

  protected actionLabel(a: DockerAction): string {
    return a === 'restart' ? 'redémarrer' : a === 'stop' ? 'arrêter' : 'démarrer';
  }

  protected runConfirmed(): void {
    const cf = this.confirmState();
    if (!cf) return;
    this.acting.set(true);
    this.vpsApi.containerAction(cf.id, cf.action, cf.server)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.confirmState.set(null);
          this.refresh();
        },
        // Refus (lecture seule) ou commande en échec : la modale reste ouverte avec la raison.
        error: (err: unknown) => {
          this.acting.set(false);
          this.actionError.set(apiErrorMessage(err, `Impossible de ${this.actionLabel(cf.action)} ${cf.name}.`));
        },
      });
  }

  // ── Drawer logs (SSE, lecture seule) ───────────────────────────────────────
  protected openLogs(container: string): void {
    const server = this.server();
    this.logsContainer.set({ name: container, server });
    this.startStream(container, server);
  }
  protected closeLogs(): void {
    this.stopStream();
    this.logsContainer.set(null);
    this.lines.set([]);
  }
  private startStream(container: string, server: VpsServerId): void {
    this.stopStream();
    this.lines.set([]);
    this.paused.set(false);
    const token = this.auth.getAccessToken() ?? '';
    this.es = new EventSource(this.vpsApi.logsUrl(container, token, server));
    this.es.onmessage = (e) => {
      if (this.paused()) return;
      this.lines.update((prev) => {
        const next = [...prev, e.data];
        return next.length > 500 ? next.slice(-500) : next;
      });
      requestAnimationFrame(() => {
        const el = this.terminalRef()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    };
    this.es.onerror = () => this.stopStream();
  }
  private stopStream(): void { this.es?.close(); this.es = null; }
  protected togglePause(): void { this.paused.update((v) => !v); }
  protected clearLines(): void { this.lines.set([]); }
  protected lineClass(line: string): string {
    if (line.includes(' ERR') || line.includes('Error') || line.includes('"error"')) return 'log-error';
    if (line.includes('WARN') || line.includes('"warn"')) return 'log-warn';
    if (line.includes('GET ') || line.includes('POST ') || line.includes('PUT ')) return 'log-req';
    return 'log-info';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private pct(u?: { used: number; total: number }): number {
    if (!u || !u.total) return 0;
    return Math.round((u.used / u.total) * 100);
  }
  protected threshold(pct: number): string {
    return pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--teal)';
  }
  protected gb(bytes: number): string {
    const g = bytes / GB;
    return g >= 10 ? Math.round(g).toString() : (Math.round(g * 10) / 10).toString();
  }
  protected formatUptime(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d > 0 ? `${d}j ${h}h` : `${h}h`;
  }

  ngOnDestroy(): void { this.stopStream(); }
}
