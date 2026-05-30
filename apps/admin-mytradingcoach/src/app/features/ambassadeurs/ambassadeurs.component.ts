import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { AdminApi, AdminAmbassador, AdminAmbassadorDetail } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-ambassadeurs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, NgClass],
  styleUrl: './ambassadeurs.component.css',
  template: `
    <div class="content">
      <h1 class="page-title">Ambassadeurs</h1>

      <!-- KPIs globaux -->
      <div class="stats-row">
        <div class="stat-card purple">
          <div class="stat-label">Ambassadeurs</div>
          <div class="stat-value">{{ ambassadors().length }}</div>
          <div class="stat-change neutral">actifs</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-label">Total référés</div>
          <div class="stat-value">{{ totalReferrals() }}</div>
          <div class="stat-change neutral">via liens</div>
        </div>
        <div class="stat-card amber">
          <div class="stat-label">Référés Starter</div>
          <div class="stat-value">{{ totalStarter() }}</div>
          <div class="stat-change neutral">39€/mois</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Référés Premium</div>
          <div class="stat-value">{{ totalPremium() }}</div>
          <div class="stat-change neutral">79€/mois</div>
        </div>
        <div class="stat-card amber">
          <div class="stat-label">Commissions dues</div>
          <div class="stat-value">{{ totalPending() | number:'1.2-2' }}€</div>
          <div class="stat-change neutral">à verser</div>
        </div>
        <div class="stat-card teal">
          <div class="stat-label">Total payé</div>
          <div class="stat-value">{{ totalPaid() | number:'1.2-2' }}€</div>
          <div class="stat-change neutral">versé</div>
        </div>
      </div>

      <!-- Tableau ambassadeurs -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Ambassadeurs</span>
          <button class="card-action-btn" (click)="copyCommand()">📋 Copier SQL ajout</button>
        </div>

        @if (loading()) {
          <div class="loading">Chargement...</div>
        } @else if (ambassadors().length === 0) {
          <div class="empty">Aucun ambassadeur configuré</div>
        } @else {
          <table class="data-table">
            <thead>
              <tr>
                <th>Ambassadeur</th>
                <th>Code / Lien</th>
                <th>Taux</th>
                <th>Référés</th>
                <th>Starter / Prem.</th>
                <th>Dû</th>
                <th>Total payé</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (amb of ambassadors(); track amb.id) {
                <tr [class.selected]="selectedId() === amb.id"
                    (click)="selectAmbassador(amb)">
                  <td>
                    <div class="user-cell">
                      <div class="avatar">{{ (amb.name || amb.email)[0].toUpperCase() }}</div>
                      <div>
                        <div class="user-name">{{ amb.name ?? '—' }}</div>
                        <div class="user-email">{{ amb.email }}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div class="code-cell">
                      <span class="ref-code">{{ amb.referralCode }}</span>
                      <button class="copy-btn"
                              (click)="$event.stopPropagation(); copyLink(amb.referralCode)">
                        Copier lien
                      </button>
                    </div>
                    <div class="ref-url">mytradingcoach.app?ref={{ amb.referralCode }}</div>
                  </td>
                  <td><span class="rate-badge">20%</span></td>
                  <td class="mono">{{ amb.totalReferrals }}</td>
                  <td class="mono">
                    <span style="color: var(--blue-bright)">{{ amb.starterReferrals }}</span>
                    <span style="color: var(--text-muted, #5a7a99); font-size: 10px;"> S</span>
                    <span style="color: var(--text-muted, #5a7a99);"> / </span>
                    <span style="color: #10b981">{{ amb.premiumReferrals }}</span>
                    <span style="color: var(--text-muted, #5a7a99); font-size: 10px;"> P</span>
                  </td>
                  <td class="mono amber">{{ amb.pendingPayout | number:'1.2-2' }}€</td>
                  <td class="mono green">{{ (amb.totalEarned - amb.pendingPayout) | number:'1.2-2' }}€</td>
                  <td>
                    <button class="action-btn"
                            [disabled]="amb.pendingPayout === 0"
                            (click)="$event.stopPropagation(); payAmbassador(amb)">
                      ✓ Payer
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <!-- Détail ambassadeur sélectionné -->
      @if (selectedDetail(); as detail) {
        <div class="card">
          <div class="card-header">
            <span class="card-title">
              Détail — {{ selectedAmbassador()?.name ?? selectedAmbassador()?.email }}
            </span>
            <button class="pay-all-btn"
                    [disabled]="detail.pendingPayout === 0 || paying()"
                    (click)="paySelected()">
              {{ paying() ? 'En cours...' : '✓ Marquer tout payé (' + (detail.pendingPayout | number:'1.2-2') + '€)' }}
            </button>
          </div>

          <!-- Mini stats -->
          <div class="detail-stats">
            <div class="detail-stat">
              <div class="detail-stat-val blue">{{ detail.total }}</div>
              <div class="detail-stat-lbl">Inscrits</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val green">{{ detail.premium }}</div>
              <div class="detail-stat-lbl">Premium</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val blue">{{ detail.starter }}</div>
              <div class="detail-stat-lbl">Starter</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val">{{ detail.free }}</div>
              <div class="detail-stat-lbl">FREE</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val amber">{{ detail.pendingPayout | number:'1.2-2' }}€</div>
              <div class="detail-stat-lbl">À payer</div>
            </div>
            <div class="detail-stat">
              <div class="detail-stat-val green">{{ detail.totalEarned | number:'1.2-2' }}€</div>
              <div class="detail-stat-lbl">Total gagné</div>
            </div>
          </div>

          <!-- Gains par mois -->
          @if (monthsSorted().length > 0) {
            <div class="months-section">
              <div class="section-label">Gains par mois</div>
              <div class="months-list">
                @for (m of monthsSorted(); track m.month) {
                  <div class="month-row">
                    <span class="month-label">{{ formatMonth(m.month) }}</span>
                    <span class="month-amount">+{{ m.amount | number:'1.2-2' }}€</span>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Table des référés -->
          <div class="section-label" style="margin-top:16px">Référés ({{ detail.referrals.length }})</div>
          @if (detail.referrals.length === 0) {
            <div class="empty">Aucun référé encore</div>
          } @else {
            <table class="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nom</th>
                  <th>Plan</th>
                  <th>Actif</th>
                  <th>Inscrit le</th>
                </tr>
              </thead>
              <tbody>
                @for (ref of detail.referrals; track ref.id) {
                  <tr>
                    <td class="mono small">{{ ref.email }}</td>
                    <td>{{ ref.name ?? '—' }}</td>
                    <td>
                      <span class="plan-badge" [ngClass]="ref.plan.toLowerCase()">
                        {{ ref.plan }}
                      </span>
                    </td>
                    <td>
                      <span [class.active-dot]="ref.isActive"
                            [class.inactive-dot]="!ref.isActive">
                        {{ ref.isActive ? '✓' : '—' }}
                      </span>
                    </td>
                    <td class="mono small">{{ ref.createdAt | date:'dd/MM/yyyy' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }

          <!-- SQL paiement -->
          <div class="sql-block">
            <div class="sql-label">SQL — marquer payé manuellement</div>
            <code>UPDATE "ReferralCommission" SET status = 'paid'
WHERE "ambassadorId" = '{{ selectedId() }}'
AND status = 'pending';</code>
          </div>
        </div>
      }

      <!-- Taux configurables -->
      <div class="card">
        <div class="card-header"><span class="card-title">Taux de commission</span></div>
        <div class="rates-grid">
          <div class="rate-card green">
            <div class="rate-label">Taux ambassadeur</div>
            <div class="rate-value">20%</div>
            <div class="rate-desc">Starter : 7,80€/mois · Premium : 15,80€/mois</div>
          </div>
          <div class="rate-card blue">
            <div class="rate-label">Futur ambassadeur</div>
            <div class="rate-value">?%</div>
            <div class="rate-desc">à définir au cas par cas</div>
          </div>
          <div class="rate-card gray">
            <div class="rate-label">Paiement</div>
            <div class="rate-value">Manuel</div>
            <div class="rate-desc">virement mensuel sur relevé</div>
          </div>
        </div>
        <div class="info-banner">
          ⚠️ Taux gérés manuellement — champ referralRate à ajouter en BDD si plusieurs taux
        </div>
      </div>
    </div>
  `,
})
export class AmbassadeursComponent implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ambassadors = signal<AdminAmbassador[]>([]);
  protected readonly loading = signal(true);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedDetail = signal<AdminAmbassadorDetail | null>(null);
  protected readonly selectedAmbassador = signal<AdminAmbassador | null>(null);
  protected readonly paying = signal(false);

  protected readonly totalReferrals = computed(() =>
    this.ambassadors().reduce((s, a) => s + a.totalReferrals, 0),
  );
  protected readonly totalStarter = computed(() =>
    this.ambassadors().reduce((s, a) => s + a.starterReferrals, 0),
  );
  protected readonly totalPremium = computed(() =>
    this.ambassadors().reduce((s, a) => s + a.premiumReferrals, 0),
  );
  protected readonly totalPending = computed(() =>
    this.ambassadors().reduce((s, a) => s + a.pendingPayout, 0),
  );
  protected readonly totalPaid = computed(() =>
    this.ambassadors().reduce((s, a) => s + a.totalEarned - a.pendingPayout, 0),
  );
  protected readonly monthsSorted = computed(() => {
    const earnings = this.selectedDetail()?.earningsByMonth ?? {};
    return Object.entries(earnings)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, amount]) => ({ month, amount }));
  });

  ngOnInit() {
    this.loadAmbassadors();
  }

  private loadAmbassadors(): void {
    this.loading.set(true);
    this.api.getAmbassadors()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ambassadors.set(res.data);
          this.loading.set(false);
          if (res.data.length > 0) this.selectAmbassador(res.data[0]);
        },
        error: () => this.loading.set(false),
      });
  }

  protected selectAmbassador(amb: AdminAmbassador): void {
    this.selectedId.set(amb.id);
    this.selectedAmbassador.set(amb);
    this.selectedDetail.set(null);

    this.api.getAmbassadorDetail(amb.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (res) => this.selectedDetail.set(res.data) });
  }

  protected copyLink(code: string): void {
    navigator.clipboard.writeText(`https://mytradingcoach.app?ref=${code}`);
  }

  protected copyCommand(): void {
    navigator.clipboard.writeText(
      `UPDATE "User" SET role = 'AMBASSADOR', "referralCode" = 'CODE' WHERE email = 'email@exemple.com';`,
    );
  }

  protected payAmbassador(amb: AdminAmbassador): void {
    if (amb.pendingPayout === 0) return;
    if (!confirm(`Marquer ${amb.pendingPayout.toFixed(2)}€ comme payé à ${amb.name ?? amb.email} ?`)) return;
    this.paying.set(true);
    this.api.markAmbassadorPaid(amb.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.paying.set(false);
          this.loadAmbassadors();
        },
        error: () => this.paying.set(false),
      });
  }

  protected paySelected(): void {
    const amb = this.selectedAmbassador();
    if (amb) this.payAmbassador(amb);
  }

  protected formatMonth(month: string): string {
    const [year, m] = month.split('-');
    return new Date(+year, +m - 1, 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
  }
}
