import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, Sparkles, AlertTriangle, Info, Lightbulb, AlertCircle, Send } from 'lucide-angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { environment } from '../../../environments/environment';

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
  imports: [FormsModule, LucideAngularModule, TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-insights.component.css',
  template: `
    <mtc-topbar
      title="IA Insights"
      [showAddButton]="true"
      [addLabel]="insightsLoading() ? 'Analyse en cours...' : 'Analyser maintenant'"
      [addLoading]="insightsLoading()"
      (addClick)="loadInsights()"
    />

    <div class="content">
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

            <div class="insight-list">
              @for (insight of insights()!.insights; track insight.title) {
                @let variant = getVariant(insight.type);
                <div class="insight-item">
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
            <div class="chat-title">
              <lucide-icon [img]="SparklesIcon" [size]="14" color="var(--blue-bright)" />
              Coach IA
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
              <div class="msg" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
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
              [(ngModel)]="chatInput"
              placeholder="Pose ta question..."
              (keydown.enter)="sendMessage()"
              [disabled]="chatLoading()"
              class="chat-input"
            />
            <button class="btn-send" (click)="sendMessage()" [disabled]="chatLoading() || !chatInput.trim()">
              <lucide-icon [img]="SendIcon" [size]="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AiInsightsComponent implements AfterViewChecked {
  @ViewChild('chatContainer') chatContainer!: ElementRef<HTMLDivElement>;

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

  private shouldScrollToBottom = false;

  protected getVariant(type: string): InsightVariant { return insightVariant(type); }

  loadInsights() {
    if (this.insightsLoading()) return;
    this.insightsLoading.set(true);
    this.insightsError.set(null);
    this.http.post<{ data: InsightsResponse }>(`${environment.apiUrl}/ai/insights`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => { this.insights.set(res.data); this.insightsLoading.set(false); },
      error: (err) => {
        this.insightsError.set(err.error?.message ?? 'Erreur lors de l\'analyse IA');
        this.insightsLoading.set(false);
      },
    });
  }

  sendSuggestion(text: string) { this.chatInput = text; this.sendMessage(); }

  sendMessage() {
    const msg = this.chatInput.trim();
    if (!msg || this.chatLoading()) return;
    this.chatInput = '';
    const history = this.chatHistory();
    this.chatHistory.update((h) => [...h, { role: 'user', content: msg }]);
    this.chatLoading.set(true);
    this.shouldScrollToBottom = true;

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
