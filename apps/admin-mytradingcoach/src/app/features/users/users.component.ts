import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { LucideAngularModule, Search, X } from 'lucide-angular';
import { AdminApi, AdminUser, AdminUserDetail } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-users',
  standalone: true,
  imports: [FormsModule, DatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './users.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Utilisateurs</h1>
        <div class="search-bar">
          <lucide-icon [img]="SearchIcon" [size]="12" color="var(--text3)" />
          <input type="text" placeholder="Rechercher..." [value]="searchValue()" (input)="onSearch($event)" />
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Utilisateur</th><th>Plan</th><th>Rôle</th><th>Abonnement</th><th>Activité</th><th>Inscrit</th></tr></thead>
            <tbody>
              @if (loading()) {
                <tr><td colspan="6" class="loading-cell">Chargement...</td></tr>
              } @else {
                @for (u of users(); track u.id) {
                  <tr (click)="selectUser(u)">
                    <td>
                      <div class="user-cell">
                        <div class="user-avatar">{{ (u.name ?? u.email)[0].toUpperCase() }}</div>
                        <div>
                          <div class="user-name">{{ u.name ?? '—' }}</div>
                          <div class="user-email">{{ u.email }}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="plan-badge"
                        [class.premium]="u.plan==='PREMIUM' && u.role!=='BETA_TESTER'"
                        [class.beta]="u.role==='BETA_TESTER'"
                        [class.free]="u.plan==='FREE'">
                        {{ u.role === 'BETA_TESTER' ? 'BETA' : u.plan }}
                      </span>
                    </td>
                    <td><span class="role-badge" [class.admin]="u.role==='ADMIN'">{{ u.role }}</span></td>
                    <td class="mono-text">
                      @if (u.role === 'BETA_TESTER') {
                        <span class="badge-beta">Offert</span>
                      } @else if (u.stripeInterval) {
                        {{ u.stripeInterval === 'month' ? 'Mensuel' : 'Annuel' }}
                        @if (u.stripeCurrentPeriodEnd) { · {{ u.stripeCurrentPeriodEnd | date:'dd/MM/yy' }} }
                      } @else if (u.trialEndsAt) {
                        Essai · {{ u.trialEndsAt | date:'dd/MM/yy' }}
                      } @else { — }
                    </td>
                    <td class="mono-text">{{ u.lastSeenAt ? (u.lastSeenAt | date:'dd/MM HH:mm') : '—' }}</td>
                    <td class="mono-text">{{ u.createdAt | date:'dd/MM/yy' }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        <div class="table-footer">
          <span class="footer-total">{{ total() }} utilisateurs</span>
          <div class="pagination">
            <button [disabled]="page() <= 1" (click)="prevPage()">←</button>
            <span>{{ page() }} / {{ totalPages() }}</span>
            <button [disabled]="page() >= totalPages()" (click)="nextPage()">→</button>
          </div>
        </div>
      </div>

      @if (selectedUser()) {
        <div class="detail-panel">
          <div class="detail-header">
            <div class="detail-avatar">{{ (selectedUser()!.name ?? selectedUser()!.email)[0].toUpperCase() }}</div>
            <div>
              <div class="detail-name">{{ selectedUser()!.name ?? selectedUser()!.email }}</div>
              <div class="detail-email">{{ selectedUser()!.email }}</div>
            </div>
            <button class="detail-close" (click)="selectedUser.set(null)">
              <lucide-icon [img]="XIcon" [size]="14" />
            </button>
          </div>
          <div class="detail-body">
            @if (detailData(); as d) {
              <div class="detail-stats">
                <div class="detail-stat"><div class="detail-stat-label">Trades</div><div class="detail-stat-value">{{ d.stats.totalTrades }}</div></div>
                <div class="detail-stat"><div class="detail-stat-label">Ce mois</div><div class="detail-stat-value">{{ d.stats.tradesThisMonth }}</div></div>
                <div class="detail-stat"><div class="detail-stat-label">Tokens IA</div><div class="detail-stat-value teal">{{ d.stats.totalTokens }}</div></div>
                <div class="detail-stat"><div class="detail-stat-label">Sessions IA</div><div class="detail-stat-value">{{ d.stats.totalAiCalls }}</div></div>
              </div>
              <div class="section-title">Informations</div>
              <div class="detail-row"><span class="detail-row-label">Plan</span><span class="detail-row-value">{{ selectedUser()!.plan }}</span></div>
              <div class="detail-row"><span class="detail-row-label">Rôle</span><span class="detail-row-value">{{ selectedUser()!.role }}</span></div>
              <div class="detail-row"><span class="detail-row-label">Inscrit</span><span class="detail-row-value">{{ selectedUser()!.createdAt | date:'dd/MM/yyyy' }}</span></div>
              @if (d.timeline.length > 0) {
                <div class="section-title">Activité récente</div>
                <div class="timeline">
                  @for (t of d.timeline.slice(0,5); track t.createdAt) {
                    <div class="timeline-item">
                      <div class="timeline-dot" [class.blue]="t.type==='auth'" [class.amber]="t.type==='ai'"></div>
                      <div><div class="timeline-action">{{ t.action }}</div><div class="timeline-time">{{ t.createdAt | date:'dd/MM HH:mm' }}</div></div>
                    </div>
                  }
                </div>
              }
            }
          </div>
          <div class="detail-actions">
            <button class="btn btn-ghost" (click)="selectedUser.set(null)">Fermer</button>
            <button class="btn btn-danger" (click)="deleteUser(selectedUser()!.id)">Supprimer</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class UsersComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly SearchIcon = Search;
  protected readonly XIcon = X;
  protected readonly loading = signal(true);
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly searchValue = signal('');
  protected readonly selectedUser = signal<AdminUser | null>(null);
  protected readonly detailData = signal<AdminUserDetail | null>(null);
  protected readonly totalPages = () => Math.max(1, Math.ceil(this.total() / 20));

  private readonly search$ = new Subject<string>();

  constructor() {
    this.loadUsers();
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page.set(1); this.loadUsers(); });
  }

  protected onSearch(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.searchValue.set(v);
    this.search$.next(v);
  }

  protected selectUser(u: AdminUser) {
    this.selectedUser.set(u);
    this.detailData.set(null);
    this.adminApi.detail(u.id).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => this.detailData.set(r.data));
  }

  protected prevPage() { if (this.page() > 1) { this.page.update(p => p - 1); this.loadUsers(); } }
  protected nextPage() { if (this.page() < this.totalPages()) { this.page.update(p => p + 1); this.loadUsers(); } }

  protected deleteUser(id: string) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    this.adminApi.delete(id).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.selectedUser.set(null); this.loadUsers(); });
  }

  private loadUsers() {
    this.loading.set(true);
    this.adminApi.list(this.page(), 20, this.searchValue() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(r => { this.users.set(r.data.users); this.total.set(r.data.total); this.loading.set(false); });
  }
}
