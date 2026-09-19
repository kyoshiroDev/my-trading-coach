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
import {
  LucideDynamicIcon,
  LucideSparkles as Sparkles,
  LucideAlertTriangle as AlertTriangle,
  LucideInfo as Info,
  LucideLightbulb as Lightbulb,
  LucideAlertCircle as AlertCircle,
  LucideSend as Send,
} from '@lucide/angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { interval } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { todayParis } from '../../core/utils/paris-date';
import { apiErrorMessage } from '../../core/utils/api-error';
import { AiApi } from '../../core/api/ai.api';

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
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type InsightVariant = 'warn' | 'info' | 'tip' | 'alert';

function insightVariant(type: string): InsightVariant {
  if (type === 'strength') return 'tip';
  if (type === 'weakness') return 'alert';
  return 'info';
}

@Component({
  selector: 'mtc-ai-insights',
  imports: [
    FormsModule,
    LucideDynamicIcon,
    TopbarComponent,
    PlanModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-insights.component.css',
  templateUrl: './ai-insights.component.html',
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
  private readonly aiApi = inject(AiApi);
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
    interval(1000).pipe(
      startWith(0),
      map(() => Date.now()),
    ),
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

    // Cooldown = endpoint Premium (PremiumGuard) : ne l'appeler que pour un Premium,
    // sinon 403 inutile (les non-premium voient le paywall).
    if (this.userStore.isPremium()) {
      this.aiApi
        .cooldown()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            const secs = res.data?.cooldownSeconds ?? 0;
            if (secs > 0) this.cooldownUntil.set(Date.now() + secs * 1000);
          },
        });
    }

    // Démo : pré-charger les insights figés (instantané, zéro appel modèle) sans clic.
    if (this.userStore.isDemo()) {
      this.loadInsights();
    }
  }

  private getQuotaKey(): string {
    return `mtc_chat_quota_${todayParis()}`;
  }

  private loadChatQuota(): number {
    try {
      const stored = localStorage.getItem(this.getQuotaKey());
      return stored !== null
        ? Math.max(0, parseInt(stored, 10))
        : this.QUOTA_MAX;
    } catch {
      /* localStorage indisponible (SSR ou permission refusée) : retourne quota max */
      return this.QUOTA_MAX;
    }
  }

  private saveChatQuota(value: number): void {
    try {
      localStorage.setItem(this.getQuotaKey(), String(value));
    } catch {
      /* localStorage indisponible : quota non persisté */
    }
  }

  private getNextMidnight(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  protected getVariant(type: string): InsightVariant {
    return insightVariant(type);
  }

  loadInsights() {
    if (
      this.insightsLoading() ||
      (!this.userStore.isAdmin() && this.cooldownLabel())
    )
      return;
    this.insightsLoading.set(true);
    this.insightsError.set(null);
    this.aiApi
      .insights<InsightsResponse>()
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
          this.insightsError.set(
            apiErrorMessage(err, "Erreur lors de l'analyse IA"),
          );
          this.insightsLoading.set(false);
        },
      });
  }

  sendSuggestion(text: string) {
    this.chatInput = text;
    this.sendMessage();
  }

  sendMessage() {
    const msg = this.chatInput.trim();
    if (
      !msg ||
      this.chatLoading() ||
      (!this.userStore.isAdmin() && this.quotaExhausted())
    )
      return;
    this.chatInput = '';
    const history = this.chatHistory();
    this.chatHistory.update((h) => [...h, { role: 'user', content: msg }]);
    this.chatLoading.set(true);
    this.shouldScrollToBottom = true;

    // Décrémenter le quota (pas pour les admins)
    if (!this.userStore.isAdmin()) {
      const newQuota = Math.max(0, this.chatQuota() - 1);
      this.chatQuota.set(newQuota);
      this.saveChatQuota(newQuota);
    }

    this.aiApi
      .chat(msg, history.slice(-6))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.chatHistory.update((h) => [
            ...h,
            { role: 'assistant', content: res.data.response },
          ]);
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
          this.chatHistory.update((h) => [
            ...h,
            { role: 'assistant', content: apiErrorMessage(err, 'Erreur IA.') },
          ]);
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
