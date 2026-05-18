import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { LucideAngularModule, Search, Trash2, Pencil, X, ShieldCheck, Wifi, Eye, TrendingUp, Bot } from 'lucide-angular';
import { AdminApi, AdminUser, AdminStats, AdminOnlineUser, AdminUserDetail } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-users',
  standalone: true,
  imports: [DatePipe, DecimalPipe, KeyValuePipe, FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './users.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Utilisateurs</h1>
        <div class="search-bar">
          <lucide-icon [img]="SearchIcon" [size]="12" color="var(--text3)" />
          <label for="users-search" class="sr-only">Rechercher</label>
          <input id="users-search" type="text" placeholder="Rechercher par email ou nom…"
            [value]="search()" (input)="onSearch($any($event.target).value)" />
        </div>
      </div>

      <!-- Stats MRR -->
      @if (stats(); as s) {
        <div class="stats-grid">
          <div class="stat-block">
            <div class="stat-block-label">MRR</div>
            <div class="stat-block-value text-teal">{{ s.mrr }}€</div>
            <div class="stat-block-sub">ARR {{ s.arr }}€</div>
          </div>
          <div class="stat-block">
            <div class="stat-block-label">Premium actifs</div>
            <div class="stat-block-value">{{ s.totalPremium }}</div>
            <div class="stat-block-sub">{{ s.monthly }} mensuel · {{ s.annual }} annuel</div>
          </div>
          <div class="stat-block">
            <div class="stat-block-label">Trials actifs</div>
            <div class="stat-block-value text-blue">{{ s.trials }}</div>
            <div class="stat-block-sub">En période d'essai</div>
          </div>
          <div class="stat-block">
            <div class="stat-block-label">Nouveaux ce mois</div>
            <div class="stat-block-value">{{ s.newThisMonth }}</div>
            <div class="stat-block-sub">Inscrits en {{ getMonthLabel() }}</div>
          </div>
          <div class="stat-block">
            <div class="stat-block-label">Churns ce mois</div>
            <div class="stat-block-value text-red">{{ s.churnedThisMonth }}</div>
            <div class="stat-block-sub">Passés en FREE</div>
          </div>
        </div>
      }

      <!-- Connectés maintenant -->
      <div class="online-panel">
        <div class="online-panel-header">
          <lucide-icon [img]="WifiIcon" [size]="13" />
          <span>Connectés maintenant</span>
          <span class="online-count">{{ onlineUsers().length }}</span>
        </div>
        @if (onlineUsers().length === 0) {
          <div class="online-empty">Aucun utilisateur actif</div>
        } @else {
          <div class="online-list">
            @for (u of onlineUsers(); track u.id) {
              <div class="online-card">
                <div class="online-avatar">
                  <span>{{ (u.name ?? u.email).slice(0,2).toUpperCase() }}</span>
                  <span class="online-dot"></span>
                </div>
                <div class="online-info">
                  <span class="online-name">{{ u.name ?? u.email }}</span>
                  @if (u.name) { <span class="online-email">{{ u.email }}</span> }
                </div>
                <div class="online-meta">
                  <span class="plan-badge"
                    [class.premium]="u.plan==='PREMIUM'"
                    [class.free]="u.plan==='FREE'">
                    {{ u.plan }}
                  </span>
                  <span class="online-session">⏱ {{ sessionDuration(u) }}</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Table -->
      @if (loading()) {
        <div class="loading-cell">Chargement...</div>
      } @else if (users().length === 0) {
        <div class="loading-cell">Aucun utilisateur trouvé.</div>
      } @else {
        <div class="card">
          <div class="table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Rôle</th>
                  <th>Plan</th>
                  <th>Abonnement</th>
                  <th>Activité</th>
                  <th>Session</th>
                  <th>Inscrit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (u of users(); track u.id) {
                  <tr>
                    <td>
                      <div class="user-cell">
                        <div class="user-avatar-wrap">
                          {{ initials(u) }}
                          @if (isOnline(u)) { <span class="avatar-dot"></span> }
                        </div>
                        <div>
                          <div class="user-name">{{ u.name ?? '—' }}</div>
                          <div class="user-email">{{ u.email }}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="role-badge"
                        [class.admin]="u.role==='ADMIN'"
                        [class.beta-role]="u.role==='BETA_TESTER'">
                        {{ u.role }}
                      </span>
                    </td>
                    <td>
                      <span class="plan-badge"
                        [class.premium]="u.plan==='PREMIUM'"
                        [class.free]="u.plan==='FREE'">
                        {{ u.plan }}
                      </span>
                    </td>
                    <td>
                      @if (u.plan === 'PREMIUM') {
                        <span [class]="'sub-badge sub-badge--' + subType(u)">{{ subLabel(u) }}</span>
                      } @else { <span class="mono-text text3-color">—</span> }
                    </td>
                    <td class="mono-text text3-color" [class.text-teal]="isOnline(u)">
                      {{ relativeTime(u.lastSeenAt) }}
                    </td>
                    <td class="mono-text text3-color">
                      @if (u.lastLoginAt) {
                        {{ sessionDuration({ lastLoginAt: u.lastLoginAt, lastSeenAt: u.lastSeenAt ?? '', id: u.id, email: u.email, name: u.name, plan: u.plan, role: u.role }) }}
                      } @else { — }
                    </td>
                    <td class="mono-text text3-color">{{ u.createdAt | date:'dd/MM/yyyy' }}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn-icon" (click)="openProfile(u, $event)" aria-label="Voir le profil">
                          <lucide-icon [img]="EyeIcon" [size]="13" />
                        </button>
                        @if (u.role !== 'ADMIN') {
                          <button class="btn-icon" (click)="openEdit(u)" aria-label="Modifier">
                            <lucide-icon [img]="PencilIcon" [size]="13" />
                          </button>
                          <button class="btn-icon danger" (click)="openDeleteModal(u)" aria-label="Supprimer">
                            <lucide-icon [img]="Trash2Icon" [size]="13" />
                          </button>
                        } @else {
                          <lucide-icon [img]="ShieldCheckIcon" [size]="14" color="var(--blue)" />
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (totalPages() > 1) {
            <div class="pagination">
              <button class="btn-page" [disabled]="page() === 1" (click)="changePage(page()-1)">← Précédent</button>
              <span class="mono-text text3-color">{{ page() }} / {{ totalPages() }}</span>
              <button class="btn-page" [disabled]="page() === totalPages()" (click)="changePage(page()+1)">Suivant →</button>
            </div>
          }
        </div>
      }
    </div>

    <!-- ── Modal Profil Utilisateur ── -->
    @if (viewingUser()) {
      <div class="modal-overlay" role="button" tabindex="0" aria-label="Fermer"
        (click)="closeProfile()" (keydown.escape)="closeProfile()">
        <div class="modal modal-profile" role="dialog" aria-modal="true"
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()">

          <div class="modal-header">
            <div class="profile-header-info">
              <div class="profile-avatar"
                [style.background]="viewingUser()!.role==='BETA_TESTER'
                  ? 'linear-gradient(135deg,#8b5cf6,#a78bfa)'
                  : viewingUser()!.role==='ADMIN'
                  ? 'linear-gradient(135deg,#f59e0b,#fbbf24)'
                  : 'linear-gradient(135deg,#3b82f6,#22d3ee)'">
                {{ (viewingUser()!.name ?? viewingUser()!.email).slice(0,2).toUpperCase() }}
              </div>
              <div>
                <h2 class="modal-title">{{ viewingUser()!.name ?? viewingUser()!.email }}</h2>
                <div class="profile-meta">
                  <span class="profile-email">{{ viewingUser()!.email }}</span>
                  <span class="plan-badge"
                    [class.premium]="viewingUser()!.plan==='PREMIUM' && viewingUser()!.role!=='BETA_TESTER'"
                    [class.beta]="viewingUser()!.role==='BETA_TESTER'"
                    [class.free]="viewingUser()!.plan==='FREE'">
                    {{ viewingUser()!.role==='BETA_TESTER' ? 'BETA' : viewingUser()!.plan }}
                  </span>
                  <span class="profile-since">depuis {{ viewingUser()!.createdAt | date:'dd/MM/yyyy' }}</span>
                </div>
              </div>
            </div>
            <button class="btn-icon" (click)="closeProfile()" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>

          @if (viewLoading()) {
            <div class="profile-loading">
              <div class="profile-skeleton"></div>
              <div class="profile-skeleton" style="width:70%"></div>
              <div class="profile-skeleton" style="width:50%"></div>
            </div>
          } @else if (viewError()) {
            <div class="profile-loading" style="color:var(--red);font-size:12px;font-family:var(--mono)">
              ⚠ Erreur : {{ viewError() }}
            </div>
          } @else if (viewDetail()) {
            <div class="modal-body profile-body">

              <div class="profile-section">
                <div class="profile-section-title">
                  <lucide-icon [img]="TrendingUpIcon" [size]="12" />
                  Activité trading
                </div>
                <div class="profile-stats-grid">
                  <div class="profile-stat">
                    <div class="profile-stat-label">Trades total</div>
                    <div class="profile-stat-value">{{ viewDetail()!.stats.totalTrades }}</div>
                  </div>
                  <div class="profile-stat">
                    <div class="profile-stat-label">Ce mois</div>
                    <div class="profile-stat-value">{{ viewDetail()!.stats.tradesThisMonth }}</div>
                  </div>
                  <div class="profile-stat">
                    <div class="profile-stat-label">P&L total</div>
                    <div class="profile-stat-value"
                      [class.val-pos]="(viewDetail()!.stats.totalPnl ?? 0) >= 0"
                      [class.val-neg]="(viewDetail()!.stats.totalPnl ?? 0) < 0">
                      {{ (viewDetail()!.stats.totalPnl ?? 0) >= 0 ? '+' : '' }}{{ (viewDetail()!.stats.totalPnl ?? 0) | number:'1.0-0' }}
                    </div>
                  </div>
                  <div class="profile-stat">
                    <div class="profile-stat-label">Win rate</div>
                    <div class="profile-stat-value"
                      [class.val-pos]="(viewDetail()!.stats.winRate ?? 0) >= 50"
                      [class.val-neg]="(viewDetail()!.stats.winRate ?? 0) < 40">
                      {{ viewDetail()!.stats.winRate ?? '—' }}{{ viewDetail()!.stats.winRate !== null && viewDetail()!.stats.winRate !== undefined ? '%' : '' }}
                    </div>
                  </div>
                </div>
                @if (viewDetail()!.topAssets?.length) {
                  <div class="profile-assets">
                    <span class="profile-assets-label">Assets :</span>
                    @for (a of viewDetail()!.topAssets!; track a.asset) {
                      <span class="profile-asset-tag">{{ a.asset }} ×{{ a.count }}</span>
                    }
                  </div>
                }
              </div>

              <div class="profile-section">
                <div class="profile-section-title">⚡ Profil stratégie</div>
                @if (viewDetail()!.user.tradingStyle || viewDetail()!.user.tradingStrategy?.length || viewDetail()!.user.tradingSessions?.length) {
                  <div class="profile-info-list">
                    @if (viewDetail()!.user.tradingStyle) {
                      <div class="profile-info-row">
                        <span class="profile-info-label">Style</span>
                        <span class="profile-info-val">{{ styleLabel(viewDetail()!.user.tradingStyle) }}</span>
                      </div>
                    }
                    @if (viewDetail()!.user.tradingSessions?.length) {
                      <div class="profile-info-row">
                        <span class="profile-info-label">Sessions</span>
                        <span class="profile-info-val">{{ viewDetail()!.user.tradingSessions!.map(s => sessionLabel(s)).join(' · ') }}</span>
                      </div>
                    }
                    @if (viewDetail()!.user.tradesPerDayMin !== null && viewDetail()!.user.tradesPerDayMin !== undefined) {
                      <div class="profile-info-row">
                        <span class="profile-info-label">Fréquence</span>
                        <span class="profile-info-val">{{ viewDetail()!.user.tradesPerDayMin }}–{{ viewDetail()!.user.tradesPerDayMax }} trades/jour</span>
                      </div>
                    }
                    @if (viewDetail()!.user.tradingStrategy?.length) {
                      <div class="profile-info-row">
                        <span class="profile-info-label">Stratégie</span>
                        <div class="profile-tags">
                          @for (tag of viewDetail()!.user.tradingStrategy!; track tag) {
                            <span class="profile-tag">{{ tag }}</span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                  @if (viewDetail()!.user.strategyDescription) {
                    <div class="profile-desc">"{{ viewDetail()!.user.strategyDescription }}"</div>
                  }
                } @else {
                  <p class="profile-empty">Profil stratégie non renseigné</p>
                }
              </div>

              <div class="profile-section">
                <div class="profile-section-title">
                  <lucide-icon [img]="BotIcon" [size]="12" />
                  Usage IA
                </div>
                <div class="profile-stats-grid">
                  <div class="profile-stat">
                    <div class="profile-stat-label">Appels</div>
                    <div class="profile-stat-value">{{ viewDetail()!.stats.totalAiCalls }}</div>
                  </div>
                  <div class="profile-stat">
                    <div class="profile-stat-label">Tokens</div>
                    <div class="profile-stat-value">{{ formatTokens(viewDetail()!.stats.totalTokens) }}</div>
                  </div>
                  <div class="profile-stat">
                    <div class="profile-stat-label">Coût</div>
                    <div class="profile-stat-value">{{ viewDetail()!.stats.totalCostUsd | number:'1.2-2' }} USD</div>
                  </div>
                </div>
                @if (viewDetail()!.stats.byFeature && (viewDetail()!.stats.byFeature | keyvalue)?.length) {
                  <div class="profile-features">
                    @for (kv of viewDetail()!.stats.byFeature | keyvalue; track kv.key) {
                      <div class="profile-feature-row">
                        <span class="profile-feature-name">{{ kv.key }}</span>
                        <span class="profile-feature-count">{{ $any(kv.value) }} appels</span>
                      </div>
                    }
                  </div>
                }
              </div>

              <div class="profile-section">
                <div class="profile-section-title">💳 Abonnement</div>
                <div class="profile-info-list">
                  @if (viewDetail()!.user.stripeInterval) {
                    <div class="profile-info-row">
                      <span class="profile-info-label">Type</span>
                      <span class="profile-info-val">{{ viewDetail()!.user.stripeInterval==='month' ? 'Mensuel' : 'Annuel' }}</span>
                    </div>
                  }
                  @if (viewDetail()!.user.stripeCurrentPeriodEnd) {
                    <div class="profile-info-row">
                      <span class="profile-info-label">Expiration</span>
                      <span class="profile-info-val">{{ viewDetail()!.user.stripeCurrentPeriodEnd | date:'dd/MM/yyyy' }}</span>
                    </div>
                  }
                  @if (viewDetail()!.user.lastLoginAt) {
                    <div class="profile-info-row">
                      <span class="profile-info-label">Dernière co.</span>
                      <span class="profile-info-val">{{ viewDetail()!.user.lastLoginAt | date:'dd/MM HH:mm' }}</span>
                    </div>
                  }
                  @if (viewDetail()!.user.startingCapital) {
                    <div class="profile-info-row">
                      <span class="profile-info-label">Capital</span>
                      <span class="profile-info-val">{{ viewDetail()!.user.currency ?? 'USD' }} {{ viewDetail()!.user.startingCapital | number:'1.0-0' }}</span>
                    </div>
                  }
                </div>
              </div>

              @if (viewDetail()!.timeline.length) {
                <div class="profile-section">
                  <div class="profile-section-title">🕐 Activité récente</div>
                  <div class="profile-timeline">
                    @for (t of viewDetail()!.timeline; track t.createdAt) {
                      <div class="profile-tl-item">
                        <div class="profile-tl-dot"
                          [class.dot-blue]="t.type==='auth'"
                          [class.dot-purple]="t.type==='ai'"
                          [class.dot-green]="t.type==='trade'">
                        </div>
                        <div class="profile-tl-content">
                          <span class="profile-tl-action">{{ t.action }}</span>
                          @if (t.detail) { <span class="profile-tl-detail">{{ t.detail }}</span> }
                        </div>
                        <span class="profile-tl-time">{{ t.createdAt | date:'dd/MM HH:mm' }}</span>
                      </div>
                    }
                  </div>
                </div>
              }

            </div>
          }
        </div>
      </div>
    }

    <!-- ── Modal édition ── -->
    @if (editUser()) {
      <div class="modal-overlay" role="button" tabindex="0" aria-label="Fermer"
        (click)="closeIfBackdrop($event, 'edit')" (keydown.escape)="closeEdit()">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2 class="modal-title">Modifier l'utilisateur</h2>
            <button class="btn-icon" (click)="closeEdit()" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="14" />
            </button>
          </div>
          <div class="modal-body">
            <div class="modal-email">{{ editUser()!.email }}</div>
            <div class="field">
              <label for="edit-name">Nom</label>
              <input id="edit-name" class="field-input" type="text" [(ngModel)]="editName" placeholder="Nom complet" />
            </div>
            <div class="field">
              <label for="modal-edit-plan">Plan</label>
              <select id="modal-edit-plan" class="field-select" [(ngModel)]="editPlan">
                <option value="FREE">FREE</option>
                <option value="PREMIUM">PREMIUM</option>
              </select>
            </div>
            <div class="field">
              <label for="modal-edit-role">Rôle</label>
              <select id="modal-edit-role" class="field-select" [(ngModel)]="editRole">
                <option value="USER">USER — Utilisateur standard</option>
                <option value="BETA_TESTER">BETA_TESTER — Premium offert</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" (click)="closeEdit()">Annuler</button>
            <button class="btn-save" (click)="saveEdit()" [disabled]="saving()">
              {{ saving() ? 'Enregistrement…' : 'Sauvegarder' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Modal suppression ── -->
    @if (deleteModal()) {
      <div class="modal-overlay" role="button" tabindex="0" aria-label="Fermer"
        (click)="closeIfBackdrop($event, 'delete')" (keydown.escape)="closeDeleteModal()">
        <div class="modal modal-sm" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2 class="modal-title danger-title">Supprimer l'utilisateur</h2>
            <button class="btn-icon" (click)="closeDeleteModal()" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="14" />
            </button>
          </div>
          <div class="modal-body">
            <p class="delete-msg">
              Supprimer définitivement <strong>{{ deleteModal()!.email }}</strong>
              ainsi que tous ses trades et debriefs ? Cette action est irréversible.
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" (click)="closeDeleteModal()">Annuler</button>
            <button class="action-btn danger" style="padding:7px 14px;font-size:12px;font-weight:700"
              (click)="confirmDelete()" [disabled]="saving()">
              {{ saving() ? 'Suppression…' : 'Supprimer définitivement' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class UsersComponent implements OnInit, OnDestroy {
  protected readonly SearchIcon      = Search;
  protected readonly Trash2Icon      = Trash2;
  protected readonly PencilIcon      = Pencil;
  protected readonly XIcon           = X;
  protected readonly ShieldCheckIcon = ShieldCheck;
  protected readonly WifiIcon        = Wifi;
  protected readonly EyeIcon         = Eye;
  protected readonly TrendingUpIcon  = TrendingUp;
  protected readonly BotIcon         = Bot;

  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly search$ = new Subject<string>();

  protected readonly users       = signal<AdminUser[]>([]);
  protected readonly total       = signal(0);
  protected readonly page        = signal(1);
  protected readonly loading     = signal(false);
  protected readonly saving      = signal(false);
  protected readonly stats       = signal<AdminStats | null>(null);
  protected readonly search      = signal('');
  protected readonly editUser    = signal<AdminUser | null>(null);
  protected readonly deleteModal  = signal<AdminUser | null>(null);
  protected readonly onlineUsers  = signal<AdminOnlineUser[]>([]);
  protected readonly viewingUser  = signal<AdminUser | null>(null);
  protected readonly viewDetail   = signal<AdminUserDetail | null>(null);
  protected readonly viewLoading  = signal(false);
  protected readonly viewError    = signal<string | null>(null);

  protected readonly totalPages = computed(() => Math.ceil(this.total() / 20) || 1);
  private onlineInterval?: ReturnType<typeof setInterval>;

  protected editName = '';
  protected editPlan: 'FREE' | 'PREMIUM' = 'FREE';
  protected editRole: 'USER' | 'BETA_TESTER' = 'USER';

  ngOnInit() {
    this.load();
    this.loadStats();
    this.loadOnline();
    this.onlineInterval = setInterval(() => this.loadOnline(), 30_000);
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page.set(1); this.load(); });
  }

  ngOnDestroy() { clearInterval(this.onlineInterval); }

  protected onSearch(value: string) { this.search.set(value); this.search$.next(value); }
  protected changePage(p: number)   { this.page.set(p); this.load(); }

  protected sessionDuration(user: AdminOnlineUser): string {
    if (!user.lastLoginAt) return '—';
    const ms = Date.now() - new Date(user.lastLoginAt).getTime();
    const totalMin = Math.floor(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h === 0 ? `${m}min` : `${h}h${m > 0 ? m + 'min' : ''}`;
  }

  protected relativeTime(dateStr: string | null): string {
    if (!dateStr) return 'Jamais';
    const ms = Date.now() - new Date(dateStr).getTime();
    const min = Math.floor(ms / 60_000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h}h`;
    return `il y a ${Math.floor(h / 24)}j`;
  }

  protected isOnline(user: AdminUser): boolean {
    if (!user.lastSeenAt) return false;
    return Date.now() - new Date(user.lastSeenAt).getTime() < 5 * 60_000;
  }

  protected initials(user: AdminUser): string {
    return (user.name ?? user.email).slice(0, 2).toUpperCase();
  }

  protected isFuture(dateStr: string | null): boolean {
    return !!dateStr && new Date(dateStr) > new Date();
  }

  protected subType(user: AdminUser): string {
    if (user.trialEndsAt && this.isFuture(user.trialEndsAt)) return 'trial';
    if (user.stripeInterval === 'year') return 'annual';
    if (user.stripeInterval === 'month') return 'monthly';
    return 'manual';
  }

  protected subLabel(user: AdminUser): string {
    return ({ trial: 'Essai', annual: 'Annuel', monthly: 'Mensuel', manual: 'Manuel' })[this.subType(user)] ?? '—';
  }

  protected getMonthLabel(): string {
    return new Date().toLocaleDateString('fr-FR', { month: 'long' });
  }

  protected closeIfBackdrop(event: MouseEvent, modal: 'edit' | 'delete') {
    if (event.target !== event.currentTarget) return;
    if (modal === 'edit') this.closeEdit(); else this.closeDeleteModal();
  }

  protected openEdit(user: AdminUser) {
    this.editUser.set(user);
    this.editName = user.name ?? '';
    this.editPlan = user.plan;
    this.editRole = user.role === 'BETA_TESTER' ? 'BETA_TESTER' : 'USER';
  }
  protected closeEdit() { this.editUser.set(null); }

  protected saveEdit() {
    const user = this.editUser();
    if (!user) return;
    this.saving.set(true);
    this.api.update(user.id, { name: this.editName || undefined, plan: this.editPlan, role: this.editRole })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => { this.users.update(list => list.map(u => u.id === r.data.id ? r.data : u)); this.saving.set(false); this.closeEdit(); },
        error: () => this.saving.set(false),
      });
  }

  protected openDeleteModal(user: AdminUser) { this.deleteModal.set(user); }
  protected closeDeleteModal() { this.deleteModal.set(null); }

  protected openProfile(user: AdminUser, event: MouseEvent): void {
    event.stopPropagation();
    this.viewingUser.set(user);
    this.viewDetail.set(null);
    this.viewError.set(null);
    this.viewLoading.set(true);
    this.api.detail(user.id).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.viewDetail.set(r.data);
          this.viewLoading.set(false);
        },
        error: (err: unknown) => {
          const msg = err instanceof Error ? err.message
            : typeof err === 'object' && err !== null && 'status' in err
            ? `HTTP ${(err as { status: number }).status}`
            : 'Erreur inconnue';
          this.viewError.set(msg);
          this.viewLoading.set(false);
        },
      });
  }

  protected closeProfile(): void {
    this.viewingUser.set(null);
    this.viewDetail.set(null);
    this.viewError.set(null);
  }

  protected formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  protected styleLabel(style: string | null | undefined): string {
    const m: Record<string, string> = {
      SCALPING: 'Scalping', DAY_TRADING: 'Day Trading',
      SWING: 'Swing', POSITION: 'Position',
    };
    return style ? (m[style] ?? style) : '—';
  }

  protected sessionLabel(s: string): string {
    return ({ LONDON: 'London', NEW_YORK: 'New York', ASIAN: 'Asian' } as Record<string, string>)[s] ?? s;
  }

  protected confirmDelete() {
    const user = this.deleteModal();
    if (!user) return;
    this.saving.set(true);
    this.api.delete(user.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.users.update(list => list.filter(u => u.id !== user.id)); this.total.update(t => t - 1); this.saving.set(false); this.closeDeleteModal(); },
      error: () => this.saving.set(false),
    });
  }

  private load() {
    this.loading.set(true);
    this.api.list(this.page(), 20, this.search() || undefined).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => { this.users.set(r.data.users); this.total.set(r.data.total); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  private loadStats() {
    this.api.stats().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.stats.set(r.data), error: () => undefined });
  }

  private loadOnline() {
    this.api.online().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.onlineUsers.set(r.data), error: () => undefined });
  }
}
