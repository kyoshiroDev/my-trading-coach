import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserStore } from '../../core/stores/user.store';
import { TradesStore } from '../../core/stores/trades.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlColorPipe } from '../../shared/pipes/pnl-color.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import { environment } from '../../../environments/environment';

interface Summary {
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  maxDrawdown: number;
  streak: number;
}

@Component({
  selector: 'mtc-dashboard',
  standalone: true,
  imports: [RouterLink, TopbarComponent, PnlColorPipe, EmotionEmojiPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mtc-topbar
      title="Dashboard"
      [showAddButton]="true"
      addLabel="Ajouter trade"
      [routerLink]="['/journal']"
    />

    <div class="content">
      <!-- Greeting -->
      <div class="greeting">
        <h1 class="greeting-title">Bonjour, {{ userStore.displayName() }} 👋</h1>
        <p class="greeting-sub">Voici un résumé de tes performances</p>
      </div>

      <!-- Stats row -->
      @if (!isLoading()) {
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-label">P&amp;L Total</div>
            <div class="stat-value" [class]="pnlClass(summary()?.totalPnl ?? 0)">
              {{ formatPnl(summary()?.totalPnl ?? 0) }}
            </div>
            <div class="stat-sub">
              <span class="change" [class]="(summary()?.totalPnl ?? 0) >= 0 ? 'up' : 'down'">
                {{ (summary()?.totalPnl ?? 0) >= 0 ? '▲' : '▼' }} ce mois
              </span>
            </div>
            <div class="stat-bg-icon">💰</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value text-blue">{{ (summary()?.winRate ?? 0).toFixed(1) }}%</div>
            <div class="stat-sub">
              <span class="change up">▲ vs mois précédent</span>
            </div>
            <div class="stat-bg-icon">🎯</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Drawdown Max</div>
            <div class="stat-value text-red">{{ formatPnl(summary()?.maxDrawdown ?? 0) }}</div>
            <div class="stat-sub">
              <span class="change down">▼ sur capital</span>
            </div>
            <div class="stat-bg-icon">📉</div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Trades</div>
            <div class="stat-value">{{ summary()?.totalTrades ?? tradesStore.trades$().length }}</div>
            <div class="stat-sub">
              <span class="change" [class]="(summary()?.streak ?? 0) >= 0 ? 'up' : 'down'">
                {{ (summary()?.streak ?? 0) >= 0 ? '▲ +' : '▼ ' }}{{ summary()?.streak ?? 0 }} streak
              </span>
            </div>
            <div class="stat-bg-icon">🔢</div>
          </div>
        </div>
      } @else {
        <div class="stats-row skeleton">
          @for (_ of [0,1,2,3]; track $index) {
            <div class="stat-card stat-skeleton"></div>
          }
        </div>
      }

      <!-- Premium upsell -->
      @if (!userStore.isPremium()) {
        <div class="premium-banner">
          <div class="premium-banner-left">
            <span class="premium-banner-icon">⚡</span>
            <div>
              <p class="premium-banner-title">Passe à <strong>Premium</strong></p>
              <p class="premium-banner-sub">Analytics avancés, IA Insights, Weekly Debrief automatique</p>
            </div>
          </div>
          <div class="premium-banner-right">
            <span class="premium-price">$19/mois</span>
            <span class="premium-trial">14 jours gratuits · sans CB</span>
          </div>
        </div>
      }

      <!-- Recent trades -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Trades récents</div>
          <a routerLink="/journal" class="card-action">Tout voir →</a>
        </div>

        @if (tradesStore.trades$().length === 0) {
          <div class="empty-state">
            <p>Aucun trade enregistré</p>
            <small>Commence par enregistrer ton premier trade dans le journal</small>
          </div>
        } @else {
          <div class="trade-list">
            @for (trade of tradesStore.trades$().slice(0, 6); track trade.id) {
              <div class="trade-row">
                <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">
                  {{ trade.side }}
                </span>
                <span class="trade-asset">{{ trade.asset }}</span>
                <span class="trade-setup">{{ trade.setup }}</span>
                <span class="trade-emotion">{{ trade.emotion | emotionEmoji }}</span>
                <span class="trade-pnl" [class]="trade.pnl | pnlColor">
                  {{ trade.pnl != null ? formatPnl(trade.pnl) : '—' }}
                </span>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .content {
      padding: 28px;
      flex: 1;
      max-width: 1200px;
    }

    /* ─── Greeting ─── */
    .greeting { margin-bottom: 28px; }
    .greeting-title {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--text);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .greeting-sub { font-size: 14px; color: var(--text-2); }

    /* ─── Stats Row ─── */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      overflow: hidden;
      transition: border-color 0.2s, transform 0.2s;
      cursor: default;
    }

    .stat-card:hover { border-color: var(--border-hover); transform: translateY(-2px); }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--blue), transparent);
      opacity: 0;
      transition: opacity 0.2s;
    }

    .stat-card:hover::before { opacity: 0.4; }

    .stat-skeleton {
      min-height: 100px;
      background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-3) 50%, var(--bg-card) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .stat-label {
      font-size: 9px;
      font-family: var(--font-mono);
      font-weight: 500;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.7px;
      margin-bottom: 10px;
    }

    .stat-value {
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -1px;
      line-height: 1;
      margin-bottom: 8px;
      color: var(--text);
    }

    .stat-sub {
      font-size: 12px;
      color: var(--text-3);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .change {
      font-family: var(--font-mono);
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .change.up { color: var(--green); background: var(--green-dim); }
    .change.down { color: var(--red); background: var(--red-dim); }

    .stat-bg-icon {
      position: absolute;
      right: 16px; top: 50%;
      transform: translateY(-50%);
      font-size: 40px;
      opacity: 0.05;
      pointer-events: none;
      user-select: none;
    }

    .text-green { color: var(--green); }
    .text-red { color: var(--red); }
    .text-blue { color: var(--blue-bright); }

    /* ─── Premium Banner ─── */
    .premium-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08));
      border: 1px solid rgba(99,155,255,0.2);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 24px;
    }

    .premium-banner-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .premium-banner-icon {
      font-size: 20px;
    }

    .premium-banner-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--text);
    }

    .premium-banner-title strong { color: var(--blue-bright); }

    .premium-banner-sub {
      font-size: 12px;
      color: var(--text-2);
      margin-top: 2px;
    }

    .premium-banner-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }

    .premium-price {
      font-family: var(--font-mono);
      font-size: 16px;
      font-weight: 500;
      color: var(--blue-bright);
    }

    .premium-trial {
      font-size: 11px;
      color: var(--text-3);
    }

    /* ─── Card ─── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: border-color 0.2s;
    }

    .card:hover { border-color: var(--border-hover); }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .card-title {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.2px;
      color: var(--text);
    }

    .card-action {
      font-size: 11px;
      color: var(--blue-bright);
      cursor: pointer;
      font-family: var(--font-mono);
      opacity: 0.8;
      transition: opacity 0.15s;
      text-decoration: none;
    }

    .card-action:hover { opacity: 1; }

    /* ─── Empty state ─── */
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-2);
    }

    .empty-state small {
      display: block;
      font-size: 12px;
      color: var(--text-3);
      margin-top: 4px;
    }

    /* ─── Trade List ─── */
    .trade-list { display: flex; flex-direction: column; gap: 8px; }

    .trade-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 10px;
      transition: all 0.15s;
    }

    .trade-row:hover { border-color: var(--border-hover); background: var(--bg-3); }

    .trade-side {
      width: 46px; height: 22px;
      border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.8px;
      flex-shrink: 0;
    }

    .trade-side.long { background: var(--green-dim); color: var(--green); }
    .trade-side.short { background: var(--red-dim); color: var(--red); }

    .trade-asset {
      font-weight: 600;
      font-size: 13px;
      min-width: 64px;
      font-family: var(--font-mono);
      color: var(--text);
    }

    .trade-setup { font-size: 11px; color: var(--text-3); flex: 1; }
    .trade-emotion { font-size: 14px; }

    .trade-pnl {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 500;
      min-width: 80px;
      text-align: right;
      color: var(--text-2);
    }

    .trade-pnl.pos { color: var(--green); }
    .trade-pnl.neg { color: var(--red); }
  `],
})
export class DashboardComponent implements OnInit {
  protected readonly userStore = inject(UserStore);
  protected readonly tradesStore = inject(TradesStore);
  private readonly http = inject(HttpClient);

  protected readonly summary = signal<Summary | null>(null);
  protected readonly isLoading = signal(true);

  ngOnInit() {
    this.tradesStore.loadTrades({ limit: '6' });
    if (this.userStore.isPremium()) {
      this.http.get<{ data: Summary }>(`${environment.apiUrl}/analytics/summary`).subscribe({
        next: (res) => { this.summary.set(res.data); this.isLoading.set(false); },
        error: () => this.isLoading.set(false),
      });
    } else {
      this.isLoading.set(false);
    }
  }

  formatPnl(v: number): string {
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${Math.abs(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  pnlClass(v: number): string {
    if (v > 0) return 'stat-value text-green';
    if (v < 0) return 'stat-value text-red';
    return 'stat-value';
  }
}
