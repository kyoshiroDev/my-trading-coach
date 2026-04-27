import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { UserStore } from '../../core/stores/user.store';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, Sparkles, AlertTriangle, Info, Lightbulb, AlertCircle, Send } from 'lucide-angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { environment } from '../../../environments/environment';
import { interval } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

interface Insight {
  type: 'strength' | 'weakness' | 'pattern';
  title: string;
  description: string;
  badge: 'Force' | 'Attention' | 'Pattern';
}
interface InsightsResponse {
  insights: Insight[];
  topPattern: string;
  emotionInsight: string;
}
interface ChatMessage { role: 'user' | 'assistant'; content: string; }

type InsightVariant = 'warn' | 'info' | 'tip' | 'alert';

function insightVariant(type: string): InsightVariant {
  if (type === 'strength') return 'tip';
  if (type === 'weakness') return 'alert';
  return 'info';
}

@Component({
  selector: 'mtc-ai-insights',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, TopbarComponent, PlanModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-insights.component.css',
  template: `
    <mtc-topbar
      title="IA Insights"
      [showAddButton]="userStore.isPremium()"
      [addLabel]="insightsLoading() ? 'Analyse en cours...' : (cooldownLabel() ? 'Disponible dans ' + cooldownLabel() : 'Analyser maintenant')"
      [addLoading]="insightsLoading()"
      [addDisabled]="!!cooldownLabel() && !insightsLoading()"
      addTestId="analyze-btn"
      (addClick)="loadInsights()"
    />

    <div class="content">
      @if (!userStore.isPremium()) {
        <div data-testid="ai-paywall" class="premium-paywall">
          <div class="paywall-icon">✨</div>
          <h3 class="paywall-title">Fonctionnalité Premium</h3>
          <p class="paywall-desc">Les IA Insights sont disponibles avec le plan Premium.<br>Analyse tes patterns comportementaux avec le coach IA.</p>
          <button class="paywall-cta" (click)="showPlanModal.set(true)">Essayer 7 jours gratuit →</button>
        </div>
        @if (showPlanModal()) {
          <mtc-plan-modal (closed)="showPlanModal.set(false)" />
        }
      } @else {
      <div class="layout">

        <!-- Left: insights -->
        <div class="insights-panel">
          <div class="panel-header">
            <span class="panel-title">Analyse IA de tes trades</span>
            @if (insightsLoading()) {
              <span class="loading-badge">
                <span class="ai-pulse"></span>
                Analyse en cours...
              </span>
            }
          </div>

          @if (insightsError()) {
            <div class="error-msg">{{ insightsError() }}</div>
          }

          @if (insights()) {
            @if (insights()!.topPattern) {
              <div class="ai-summary-block">
                <div class="ai-summary-label">
                  <span class="ai-pulse"></span>
                  Pattern principal
                </div>
                <p class="ai-summary-text">{{ insights()!.topPattern }}</p>
              </div>
            }

            @if (insights()!.emotionInsight) {
              <div class="ai-summary-block emotion-block">
                <div class="ai-summary-label">
                  <span class="ai-pulse" style="background:var(--green)"></span>
                  Émotion & Performance
                </div>
                <p class="ai-summary-text">{{ insights()!.emotionInsight }}</p>
              </div>
            }

            <div class="insight-list" data-testid="insights-list">
              @for (insight of insights()!.insights; track insight.title) {
                @let variant = getVariant(insight.type);
                <div class="insight-item" data-testid="insight-card">
                  <div class="insight-icon" [class]="variant">
                    @switch (variant) {
                      @case ('tip') { <lucide-icon [img]="LightbulbIcon" [size]="15" color="#10b981" /> }
                      @case ('alert') { <lucide-icon [img]="AlertCircleIcon" [size]="15" color="#ef4444" /> }
                      @case ('warn') { <lucide-icon [img]="AlertTriangleIcon" [size]="15" color="#f59e0b" /> }
                      @default { <lucide-icon [img]="InfoIcon" [size]="15" color="#60a5fa" /> }
                    }
                  </div>
                  <div class="insight-content">
                    <div class="insight-title">{{ insight.title }}</div>
                    <div class="insight-desc">{{ insight.description }}</div>
                  </div>
                  <span class="insight-tag" [class]="variant">{{ insight.badge }}</span>
                </div>
              }
            </div>
          } @else if (!insightsLoading()) {
            <div class="empty-insights">
              <lucide-icon [img]="SparklesIcon" [size]="32" color="var(--text-3)" style="margin-bottom:12px" />
              <p>Lance une analyse pour obtenir tes insights personnalisés</p>
              <small>L'IA analyse tes 50 derniers trades pour identifier tes patterns</small>
            </div>
          }
        </div>

        <!-- Right: chat -->
        <div class="chat-panel">
          <div class="chat-header">
            <div class="chat-title-row">
              <div class="chat-title">
                <lucide-icon [img]="SparklesIcon" [size]="14" color="var(--blue-bright)" />
                Coach IA
              </div>
              @if (quotaExhausted()) {
                <span class="quota-badge quota-exhausted">Disponible dans {{ chatQuotaCountdown() }}</span>
              } @else {
                <span class="quota-badge">{{ chatQuota() }}/{{ QUOTA_MAX }}</span>
              }
            </div>
            <span class="chat-sub">Pose tes questions sur ton trading</span>
          </div>

          <div class="chat-messages" #chatContainer>
            @if (chatHistory().length === 0) {
              <div class="chat-welcome">
                <p>Bonjour ! Je suis ton coach IA. Comment puis-je t'aider ?</p>
                <div class="suggestions">
                  @for (s of SUGGESTIONS; track s) {
                    <button class="suggestion" (click)="sendSuggestion(s)">{{ s }}</button>
                  }
                </div>
              </div>
            }
            @for (msg of chatHistory(); track $index) {
              <div class="msg" data-testid="chat-message" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
                <div class="msg-bubble">{{ msg.content }}</div>
              </div>
            }
            @if (chatLoading()) {
              <div class="msg assistant">
                <div class="msg-bubble typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            }
          </div>

          <div class="chat-input-row">
            <input
              data-testid="chat-input"
              [(ngModel)]="chatInput"
              placeholder="Pose ta question..."
              (keydown.enter)="sendMessage()"
              [disabled]="chatLoading() || quotaExhausted()"
              class="chat-input"
            />
            <button class="btn-send" data-testid="chat-send" (click)="sendMessage()" [disabled]="chatLoading() || !chatInput.trim() || quotaExhausted()">
              <lucide-icon [img]="SendIcon" [size]="14" />
            </button>
          </div>
        </div>
      </div>
      } <!-- end @else (premium) -->
    </div>
  `,
})
export class AiInsightsComponent implements AfterViewChecked {
  @ViewChild('chatContainer') chatContainer!: ElementRef<HTMLDivElement>;

  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);

  protected readonly SparklesIcon = Sparkles;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly InfoIcon = Info;
  protected readonly LightbulbIcon = Lightbulb;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly SendIcon = Send;

  protected readonly SUGGESTIONS = [
    'Quand est-ce que je trade le mieux ?',
    'Mon émotion affecte-t-elle mes résultats ?',
    'Quel est mon meilleur setup ?',
    'Comment réduire mon drawdown ?',
  ];

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly insights = signal<InsightsResponse | null>(null);
  protected readonly insightsLoading = signal(false);
  protected readonly insightsError = signal<string | null>(null);
  protected readonly chatHistory = signal<ChatMessage[]>([]);
  protected readonly chatLoading = signal(false);
  protected chatInput = '';

  protected readonly QUOTA_MAX = 50;
  protected readonly chatQuota = signal(this.QUOTA_MAX);
  protected readonly quotaExhausted = computed(() => this.chatQuota() <= 0);
  private readonly chatQuotaResetAt = signal(0);

  // Timestamp (ms) à partir duquel le cooldown est écoulé
  private readonly cooldownUntil = signal(0);

  // Horloge à la seconde
  private readonly now = toSignal(
    interval(1000).pipe(startWith(0), map(() => Date.now())),
    { initialValue: Date.now() },
  );

  // "3h 42min" ou "12min" ou null si disponible
  protected readonly cooldownLabel = computed(() => {
    const remaining = this.cooldownUntil() - this.now();
    if (remaining <= 0) return null;
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.ceil((remaining % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  });

  // HH:MM:SS jusqu'au reset minuit du quota chat
  protected readonly chatQuotaCountdown = computed(() => {
    const remaining = this.chatQuotaResetAt() - this.now();
    if (remaining <= 0) return '00:00:00';
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    const s = Math.floor((remaining % 60_000) / 1_000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  });

  private shouldScrollToBottom = false;

  constructor() {
    // Initialiser le quota chat depuis localStorage
    this.chatQuota.set(this.loadChatQuota());
    this.chatQuotaResetAt.set(this.getNextMidnight());

    // Reset automatique à minuit
    effect(() => {
      if (this.now() >= this.chatQuotaResetAt()) {
        const fresh = this.QUOTA_MAX;
        this.chatQuota.set(fresh);
        this.saveChatQuota(fresh);
        this.chatQuotaResetAt.set(this.getNextMidnight());
      }
    });

    // Vérifier le cooldown au chargement de la page
    this.http.get<{ data: { cooldownSeconds: number } }>(`${environment.apiUrl}/ai/cooldown`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const secs = res.data?.cooldownSeconds ?? 0;
          if (secs > 0) this.cooldownUntil.set(Date.now() + secs * 1000);
        },
      });
  }

  private getQuotaKey(): string {
    return `mtc_chat_quota_${new Date().toISOString().slice(0, 10)}`;
  }

  private loadChatQuota(): number {
    try {
      const stored = localStorage.getItem(this.getQuotaKey());
      return stored !== null ? Math.max(0, parseInt(stored, 10)) : this.QUOTA_MAX;
    } catch { return this.QUOTA_MAX; }
  }

  private saveChatQuota(value: number): void {
    try { localStorage.setItem(this.getQuotaKey(), String(value)); } catch { /* ignore */ }
  }

  private getNextMidnight(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  protected getVariant(type: string): InsightVariant { return insightVariant(type); }

  loadInsights() {
    if (this.insightsLoading() || this.cooldownLabel()) return;
    this.insightsLoading.set(true);
    this.insightsError.set(null);
    this.http.post<{ data: InsightsResponse }>(`${environment.apiUrl}/ai/insights`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => {
        this.insights.set(res.data);
        this.insightsLoading.set(false);
        // Cooldown 4h démarre maintenant
        this.cooldownUntil.set(Date.now() + 4 * 3_600_000);
      },
      error: (err) => {
        // Si 429, extraire le TTL renvoyé par le backend
        if (err.status === 429) {
          const secs = err.error?.cooldownSeconds;
          if (secs) this.cooldownUntil.set(Date.now() + secs * 1000);
        }
        this.insightsError.set(err.error?.message ?? 'Erreur lors de l\'analyse IA');
        this.insightsLoading.set(false);
      },
    });
  }

  sendSuggestion(text: string) { this.chatInput = text; this.sendMessage(); }

  sendMessage() {
    const msg = this.chatInput.trim();
    if (!msg || this.chatLoading() || this.quotaExhausted()) return;
    this.chatInput = '';
    const history = this.chatHistory();
    this.chatHistory.update((h) => [...h, { role: 'user', content: msg }]);
    this.chatLoading.set(true);
    this.shouldScrollToBottom = true;

    // Décrémenter le quota de façon optimiste
    const newQuota = Math.max(0, this.chatQuota() - 1);
    this.chatQuota.set(newQuota);
    this.saveChatQuota(newQuota);

    this.http.post<{ data: { response: string } }>(`${environment.apiUrl}/ai/chat`, {
      message: msg,
      history: history.slice(-6),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.chatHistory.update((h) => [...h, { role: 'assistant', content: res.data.response }]);
        this.chatLoading.set(false);
        this.shouldScrollToBottom = true;
      },
      error: (err) => {
        if (err.status === 429) {
          // Serveur confirme quota épuisé
          this.chatQuota.set(0);
          this.saveChatQuota(0);
        } else {
          // Autre erreur : restaurer le message consommé
          const restored = Math.min(this.QUOTA_MAX, this.chatQuota() + 1);
          this.chatQuota.set(restored);
          this.saveChatQuota(restored);
        }
        this.chatHistory.update((h) => [...h, { role: 'assistant', content: err.error?.message ?? 'Erreur IA.' }]);
        this.chatLoading.set(false);
        this.shouldScrollToBottom = true;
      },
    });
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom && this.chatContainer) {
      const el = this.chatContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScrollToBottom = false;
    }
  }
}
