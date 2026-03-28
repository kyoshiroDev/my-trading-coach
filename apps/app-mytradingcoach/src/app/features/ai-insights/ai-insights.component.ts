import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
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
  template: `
    <mtc-topbar title="IA Insights" [showAddButton]="true" addLabel="Analyser maintenant" (addClick)="loadInsights()" />

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
  styles: [`
    .content { padding: 28px; flex: 1; }

    .layout {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 16px;
      align-items: start;
    }

    /* ─── Panels ─── */
    .insights-panel, .chat-panel {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
    }

    .panel-title {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    .loading-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--blue-bright);
    }

    .ai-pulse {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--blue);
      animation: pulse 2s infinite;
      flex-shrink: 0;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }

    /* ─── AI Summary block ─── */
    .ai-summary-block {
      margin: 16px 20px 0;
      background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(139,92,246,0.06));
      border: 1px solid rgba(99,155,255,0.15);
      border-radius: 10px;
      padding: 14px 16px;
      position: relative;
      overflow: hidden;
    }

    .emotion-block {
      background: linear-gradient(135deg, rgba(16,185,129,0.06), rgba(59,130,246,0.06));
      border-color: rgba(16,185,129,0.15);
      margin-top: 10px;
    }

    .ai-summary-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--blue-bright);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .ai-summary-text {
      font-size: 13px;
      color: var(--text-2);
      line-height: 1.6;
    }

    /* ─── Insight list ─── */
    .insight-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 20px 20px;
    }

    .insight-item {
      display: flex;
      gap: 12px;
      padding: 12px 14px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      transition: border-color 0.2s;
      align-items: flex-start;
    }

    .insight-item:hover { border-color: var(--border-hover); }

    .insight-icon {
      width: 32px; height: 32px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }

    .insight-icon.warn { background: rgba(245,158,11,0.12); }
    .insight-icon.info { background: rgba(59,130,246,0.12); }
    .insight-icon.tip { background: rgba(16,185,129,0.12); }
    .insight-icon.alert { background: rgba(239,68,68,0.12); }

    .insight-content { flex: 1; }
    .insight-title { font-size: 13px; font-weight: 500; margin-bottom: 3px; color: var(--text); }
    .insight-desc { font-size: 12px; color: var(--text-3); line-height: 1.5; }

    .insight-tag {
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 2px 8px;
      border-radius: 4px;
      align-self: flex-start;
      white-space: nowrap;
    }

    .insight-tag.warn { background: rgba(245,158,11,0.12); color: var(--yellow); }
    .insight-tag.info { background: rgba(59,130,246,0.12); color: var(--blue-bright); }
    .insight-tag.tip { background: rgba(16,185,129,0.12); color: var(--green); }
    .insight-tag.alert { background: rgba(239,68,68,0.12); color: var(--red); }

    .error-msg {
      margin: 16px 20px;
      background: var(--red-dim);
      border: 1px solid var(--red);
      color: var(--red);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12px;
    }

    .empty-insights {
      padding: 3rem 2rem;
      text-align: center;
      color: var(--text-2);
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .empty-insights p { font-size: 14px; margin-bottom: 4px; }
    .empty-insights small { font-size: 12px; color: var(--text-3); }

    /* ─── Chat ─── */
    .chat-header {
      padding: 18px 20px;
      border-bottom: 1px solid var(--border);
    }

    .chat-title {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 2px;
    }

    .chat-sub { font-size: 11px; color: var(--text-3); }

    .chat-messages {
      height: 420px;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .chat-welcome { color: var(--text-2); font-size: 13px; }
    .chat-welcome p { margin-bottom: 12px; }

    .suggestions { display: flex; flex-direction: column; gap: 6px; }

    .suggestion {
      background: var(--bg-2);
      border: 1px solid var(--border);
      color: var(--text-2);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      text-align: left;
      font-family: var(--font-body);
      transition: all 0.15s;
    }

    .suggestion:hover { border-color: var(--blue); color: var(--blue-bright); background: var(--blue-glow); }

    .msg { display: flex; }
    .msg.user { justify-content: flex-end; }
    .msg.assistant { justify-content: flex-start; }

    .msg-bubble {
      max-width: 85%;
      padding: 9px 13px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
    }

    .user .msg-bubble {
      background: var(--blue);
      color: white;
      border-radius: 10px 10px 2px 10px;
    }

    .assistant .msg-bubble {
      background: var(--bg-2);
      border: 1px solid var(--border);
      color: var(--text-2);
      border-radius: 10px 10px 10px 2px;
    }

    .typing {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    .typing span {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--text-3);
      animation: bounce 1.2s infinite;
    }

    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-5px); }
    }

    .chat-input-row {
      display: flex;
      gap: 8px;
      padding: 12px 20px 16px;
      border-top: 1px solid var(--border);
    }

    .chat-input {
      flex: 1;
      background: var(--bg-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 13px;
      outline: none;
      font-family: var(--font-body);
      transition: border-color 0.15s;
    }

    .chat-input:focus { border-color: var(--blue); }

    .btn-send {
      background: var(--blue);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 9px 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: all 0.15s;
      box-shadow: 0 0 16px rgba(59,130,246,0.3);
    }

    .btn-send:hover { background: var(--blue-bright); }
    .btn-send:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
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
    this.http.post<{ data: InsightsResponse }>(`${environment.apiUrl}/ai/insights`, {}).subscribe({
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
    }).subscribe({
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
