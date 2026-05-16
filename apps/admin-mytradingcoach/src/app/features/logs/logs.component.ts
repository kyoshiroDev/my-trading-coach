import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  ViewChild, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Play, Pause, Trash2 } from 'lucide-angular';
import { VpsApi } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';

const CONTAINERS = ['mtc_api_prod', 'mtc_api_dev', 'mtc_postgres', 'mtc_redis', 'mtc_pgbouncer', 'mtc_traefik'];

@Component({
  selector: 'mtc-admin-logs',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './logs.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Logs système</h1>
        <div class="log-controls">
          <select [(ngModel)]="selectedContainer" (change)="startStream()">
            @for (c of containers; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
          <button class="action-btn" (click)="togglePause()" [title]="paused() ? 'Reprendre' : 'Pause'">
            <lucide-icon [img]="paused() ? PlayIcon : PauseIcon" [size]="12" />
          </button>
          <button class="action-btn" (click)="clearLines()" title="Vider">
            <lucide-icon [img]="TrashIcon" [size]="12" />
          </button>
        </div>
      </div>
      <div class="log-terminal" #terminal>
        @for (line of lines(); track $index) {
          <div class="log-line">{{ line }}</div>
        }
        @if (lines().length === 0) {
          <div class="log-empty">Sélectionne un container pour voir ses logs</div>
        }
      </div>
    </div>
  `,
})
export class LogsComponent implements OnDestroy {
  @ViewChild('terminal') terminalRef!: ElementRef<HTMLDivElement>;

  private readonly vpsApi = inject(VpsApi);
  private readonly auth = inject(AdminAuthService);
  private es: EventSource | null = null;

  protected readonly containers = CONTAINERS;
  protected selectedContainer = CONTAINERS[0];
  protected readonly lines = signal<string[]>([]);
  protected readonly paused = signal(false);
  protected readonly PlayIcon = Play;
  protected readonly PauseIcon = Pause;
  protected readonly TrashIcon = Trash2;

  constructor() {
    this.startStream();
  }

  protected startStream() {
    this.stopStream();
    this.lines.set([]);
    const token = this.auth.getAccessToken() ?? '';
    this.es = new EventSource(this.vpsApi.logsUrl(this.selectedContainer, token));
    this.es.onmessage = (e) => {
      if (this.paused()) return;
      this.lines.update(prev => {
        const next = [...prev, e.data];
        return next.length > 500 ? next.slice(-500) : next;
      });
      requestAnimationFrame(() => {
        if (this.terminalRef?.nativeElement) {
          this.terminalRef.nativeElement.scrollTop = this.terminalRef.nativeElement.scrollHeight;
        }
      });
    };
    this.es.onerror = () => this.stopStream();
  }

  protected stopStream() { this.es?.close(); this.es = null; }
  protected togglePause() { this.paused.update(v => !v); }
  protected clearLines() { this.lines.set([]); }
  ngOnDestroy() { this.stopStream(); }
}
