import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { SessionStore } from '../../core/stores/session.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { SessionMorningComponent } from '../dashboard/components/session-morning/session-morning.component';
import { SessionLiveComponent } from '../dashboard/components/session-live/session-live.component';
import { LiveModeService } from '../../core/services/live-mode.service';

@Component({
  selector: 'mtc-session-day',
  standalone: true,
  imports: [DatePipe, TopbarComponent, SessionMorningComponent, SessionLiveComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-day.component.css',
  template: `
    <mtc-topbar title="Ma session" [showAddButton]="false">
      @if (activeTab() === 'live' && store.activeSession()?.status === 'ACTIVE') {
        <div class="sess-status-pill">
          <div class="sess-pulse-dot"></div>
          <span class="sess-timer-top">{{ store.sessionTimer() }}</span>
          <span class="sess-sep">·</span>
          <span class="sess-cnt-top">{{ store.todayTrades().length }} trade{{ store.todayTrades().length > 1 ? 's' : '' }}</span>
          <span class="sess-sep">·</span>
          <span class="sess-pnl-top" [style.color]="(store.todayStats()?.totalPnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'">
            {{ (store.todayStats()?.totalPnl ?? 0) >= 0 ? '+' : '' }}{{ (store.todayStats()?.totalPnl ?? 0).toFixed(0) }}$
          </span>
          <span class="sess-sep">·</span>
          <span class="sess-emo-top">{{ store.moodEmoji(store.activeSession()?.moodStart) }}</span>
        </div>
        <button class="sess-stop-top" (click)="store.openCloseSessionModal()">Clôturer session</button>
      }
    </mtc-topbar>

    <div class="session-page" [class.live-mode]="activeTab() === 'live'">
      <div class="page-header">
        <div class="greeting-block">
          <h1 class="greeting-title">Ma session</h1>
          <div class="greeting-sub">{{ today | date:'EEEE d MMMM' }}</div>
        </div>
        <div class="tabs-block">
          <button class="session-tab" [class.active]="activeTab() === 'morning'"
                  data-testid="tab-morning" (click)="selectTab('morning')">
            ☀️ Pré-session
          </button>
          <button class="session-tab" [class.active]="activeTab() === 'live'"
                  data-testid="tab-live" (click)="selectTab('live')">
            ⚡ Session live
          </button>
        </div>
        <div class="header-spacer"></div>
      </div>

      @if (activeTab() === 'morning') {
        <mtc-session-morning
          [yesterdayRecap]="store.yesterdayRecap()"
          [objectives]="store.currentObjectives()"
          [debriefId]="store.currentDebriefId()"
          [ecoCalendar]="store.ecoCalendarDay()"
          [selectedMood]="store.selectedMood()"
          (moodSelected)="store.selectMood($event)"
          (sessionStarted)="startSession()"
          (objectiveNoteAdded)="store.updateObjectiveNote($event)"
          (planNoteChanged)="store.savePlanNote($event)"
        />
      }

      @if (activeTab() === 'live') {
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;">
          <mtc-session-live
            [session]="store.activeSession()"
            [todayTrades]="store.todayTrades()"
            [liveStats]="store.todayStats()"
            [ecoCalendar]="store.ecoCalendarDay()"
            [marketCtx]="store.marketCtx()"
            [newsItems]="store.newsItems()"
            [breakingNews]="store.breakingNews()"
            [triggerCloseModal]="store.triggerCloseModal()"
            (startSession)="startSession()"
            (tradeClosed)="store.confirmCloseTrade($event)"
            (sessionClosed)="onSessionClosed($event)"
            (tradeLogged)="store.logQuickTrade($event)"
          />
        </div>
      }
    </div>
  `,
})
export class SessionDayComponent implements OnInit {
  protected readonly store           = inject(SessionStore);
  private  readonly liveModeService  = inject(LiveModeService);
  private  readonly destroyRef       = inject(DestroyRef);

  protected readonly activeTab = signal<'morning' | 'live'>('morning');
  protected readonly today = new Date();

  constructor() {
    // Bascule automatiquement sur live quand une session est active
    effect(() => {
      if (this.store.activeSession()?.status === 'ACTIVE') {
        this.activeTab.set('live');
      }
    });

    // Gère le live-mode (overflow:hidden du conteneur principal)
    effect(() => {
      const live = this.activeTab() === 'live';
      document.body.classList.toggle('live-mode-active', live);
      if (live) { this.liveModeService.activate(); } else { this.liveModeService.deactivate(); }
    });

    this.destroyRef.onDestroy(() => {
      document.body.classList.remove('live-mode-active');
      this.liveModeService.deactivate();
    });
  }

  ngOnInit(): void {
    this.store.loadSessionData();
  }

  protected selectTab(tab: 'morning' | 'live'): void {
    this.activeTab.set(tab);
  }

  protected startSession(): void {
    this.store.startSession();
    this.activeTab.set('live');
  }

  protected onSessionClosed(payload: { mood: string; note?: string; question?: string | null }): void {
    this.store.onSessionClosed(payload as Parameters<typeof this.store.onSessionClosed>[0]);
    this.activeTab.set('morning');
  }
}
