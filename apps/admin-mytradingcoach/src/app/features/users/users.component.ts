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
import { DatePipe, DecimalPipe, KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { LucideAngularModule, Trash2, Pencil, X, ShieldCheck, Eye, TrendingUp, Bot } from 'lucide-angular';
import { AdminApi, AdminUser, AdminStats, AdminUserDetail } from '../../core/api/admin.api';
import { TableSort } from '../../shared/tables/table-sort';

@Component({
  selector: 'mtc-admin-users',
  standalone: true,
  imports: [DatePipe, DecimalPipe, KeyValuePipe, FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './users.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Utilisateurs</div>
        <div class="head-right">
          <select class="sort-mobile" [value]="sort.key()" (change)="setSort($any($event.target).value)" aria-label="Trier par">
            <option value="act">Trier : Activité</option>
            <option value="n">Trier : Utilisateur</option>
            <option value="role">Trier : Rôle</option>
            <option value="plan">Trier : Plan</option>
            <option value="ses">Trier : Session</option>
            <option value="reg">Trier : Inscrit</option>
          </select>
          <div class="search">⌕
            <input type="text" placeholder="Rechercher par email ou nom…"
              [value]="search()" (input)="onSearch($any($event.target).value)" />
          </div>
        </div>
      </div>

      @if (stats(); as s) {
        <div class="kpi-strip">
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">MRR</div><div class="kpi-value teal">{{ s.mrr }}€</div><div class="kpi-sub">ARR {{ s.arr }}€</div></div>
          <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Starter actifs</div><div class="kpi-value amber">{{ s.totalStarter }}</div><div class="kpi-sub">{{ s.starterMonthly }}m · {{ s.starterAnnual }}an</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Premium actifs</div><div class="kpi-value blue">{{ s.totalPremium }}</div><div class="kpi-sub">{{ s.premiumMonthly }}m · {{ s.premiumAnnual }}an · {{ s.trials }} essai</div></div>
          <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Ambassadeurs</div><div class="kpi-value purple">{{ s.ambassadors }}</div><div class="kpi-sub">{{ s.betaTesters }} bêta testeur{{ s.betaTesters > 1 ? 's' : '' }}</div></div>
          <div class="kpi"><div class="kpi-top green"></div><div class="kpi-label">Nouveaux ce mois</div><div class="kpi-value">{{ s.newThisMonth }}</div><div class="kpi-sub">inscrits en {{ getMonthLabel() }}</div></div>
          <div class="kpi"><div class="kpi-top red"></div><div class="kpi-label">Churn ce mois</div><div class="kpi-value red">{{ s.churnedThisMonth }}</div><div class="kpi-sub">passés en FREE</div></div>
        </div>
      }

      @if (loading()) {
        <div class="card"><div class="empty">Chargement…</div></div>
      } @else if (sortedUsers().length === 0) {
        <div class="card"><div class="empty">Aucun utilisateur trouvé.</div></div>
      } @else {
        <div class="card fill">
          <table class="tbl">
            <thead>
              <tr>
                <th class="sortable" [class.active]="sort.isActive('n')" (click)="sort.toggle('n')">Utilisateur <span class="caret">{{ sort.caret('n') }}</span></th>
                <th class="sortable" [class.active]="sort.isActive('role')" (click)="sort.toggle('role')">Rôle <span class="caret">{{ sort.caret('role') }}</span></th>
                <th class="sortable" [class.active]="sort.isActive('plan')" (click)="sort.toggle('plan')">Plan <span class="caret">{{ sort.caret('plan') }}</span></th>
                <th>Abonnement</th>
                <th class="sortable" [class.active]="sort.isActive('act')" (click)="sort.toggle('act')">Activité <span class="caret">{{ sort.caret('act') }}</span></th>
                <th class="sortable" [class.active]="sort.isActive('ses')" (click)="sort.toggle('ses')">Session <span class="caret">{{ sort.caret('ses') }}</span></th>
                <th class="sortable" [class.active]="sort.isActive('reg')" (click)="sort.toggle('reg')">Inscrit <span class="caret">{{ sort.caret('reg') }}</span></th>
                <th class="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (u of sortedUsers(); track u.id) {
                <tr>
                  <td data-label="Utilisateur"><div class="u-cell"><div class="u-av">{{ initials(u) }}</div><div><div class="u-name">{{ u.name ?? '—' }}</div><div class="u-mail">{{ u.email }}</div></div></div></td>
                  <td data-label="Rôle"><span class="role-tag" [class.purple]="u.role !== 'USER'">{{ u.role }}</span></td>
                  <td data-label="Plan"><span class="badge" [class.b-premium]="u.plan==='PREMIUM'" [class.b-starter]="u.plan==='STARTER'" [class.b-free]="u.plan==='FREE'">{{ u.plan }}</span></td>
                  <td data-label="Abonnement">
                    @if (u.plan !== 'FREE') { <span [class]="'sub-badge sub-badge--' + subType(u)">{{ subLabel(u) }}</span> }
                    @else { <span class="muted">–</span> }
                  </td>
                  <td data-label="Activité" class="td-mono" [class.muted]="!u.lastSeenAt">{{ relativeTime(u.lastSeenAt) }}</td>
                  <td data-label="Session" class="td-mono">{{ u.lastLoginAt ? sessionDuration(u.lastLoginAt) : '–' }}</td>
                  <td data-label="Inscrit" class="td-mono muted">{{ u.createdAt | date:'dd/MM/yyyy' }}</td>
                  <td data-label="Actions">
                    <div class="row-actions">
                      <button class="icon-btn" (click)="openProfile(u, $event)" aria-label="Voir le profil"><lucide-icon [img]="EyeIcon" [size]="13" /></button>
                      @if (u.role !== 'ADMIN') {
                        <button class="icon-btn" (click)="openEdit(u)" aria-label="Modifier"><lucide-icon [img]="PencilIcon" [size]="13" /></button>
                        <button class="icon-btn danger" (click)="openDeleteModal(u)" aria-label="Supprimer"><lucide-icon [img]="Trash2Icon" [size]="13" /></button>
                      } @else {
                        <lucide-icon [img]="ShieldCheckIcon" [size]="14" color="var(--blue)" />
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          @if (totalPages() > 1) {
            <div class="pagination">
              <button class="btn-page" [disabled]="page() === 1" (click)="changePage(page()-1)">← Précédent</button>
              <span class="td-mono muted">{{ page() }} / {{ totalPages() }}</span>
              <button class="btn-page" [disabled]="page() === totalPages()" (click)="changePage(page()+1)">Suivant →</button>
            </div>
          }
        </div>
      }

      <!-- ── Modal Profil Utilisateur ── -->
      @if (viewingUser()) {
        <div class="modal-overlay" role="button" tabindex="0" aria-label="Fermer"
          (click)="closeProfile()" (keydown.escape)="closeProfile()">
          <div class="modal modal-profile" role="dialog" aria-modal="true"
            (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">

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
                      [class.starter]="viewingUser()!.plan==='STARTER' && viewingUser()!.role!=='BETA_TESTER'"
                      [class.beta]="viewingUser()!.role==='BETA_TESTER'"
                      [class.ambassador]="viewingUser()!.role==='AMBASSADOR'"
                      [class.free]="viewingUser()!.plan==='FREE'">
                      {{ viewingUser()!.role==='BETA_TESTER' ? 'BETA' : viewingUser()!.role==='AMBASSADOR' ? 'AMBASSADOR' : viewingUser()!.plan }}
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
            } @else if (viewDetail(); as d) {
              <div class="modal-body profile-body">

                <div class="profile-section">
                  <div class="profile-section-title">
                    <lucide-icon [img]="TrendingUpIcon" [size]="12" />
                    Activité trading
                  </div>
                  <div class="profile-stats-grid">
                    <div class="profile-stat">
                      <div class="profile-stat-label">Trades total</div>
                      <div class="profile-stat-value">{{ d.stats.totalTrades }}</div>
                    </div>
                    <div class="profile-stat">
                      <div class="profile-stat-label">Ce mois</div>
                      <div class="profile-stat-value">{{ d.stats.tradesThisMonth }}</div>
                    </div>
                    <div class="profile-stat">
                      <div class="profile-stat-label">P&L total</div>
                      <div class="profile-stat-value"
                        [class.val-pos]="d.stats.totalPnl >= 0" [class.val-neg]="d.stats.totalPnl < 0">
                        {{ d.stats.totalPnl >= 0 ? '+' : '' }}{{ d.stats.totalPnl | number:'1.0-0' }}
                      </div>
                    </div>
                    <div class="profile-stat">
                      <div class="profile-stat-label">Win rate</div>
                      <div class="profile-stat-value"
                        [class.val-pos]="d.stats.winRate >= 50" [class.val-neg]="d.stats.winRate < 40">
                        {{ d.stats.winRate }}%
                      </div>
                    </div>
                  </div>
                  @if (d.topAssets.length) {
                    <div class="profile-assets">
                      <span class="profile-assets-label">Assets :</span>
                      @for (a of d.topAssets; track a.asset) {
                        <span class="profile-asset-tag">{{ a.asset }} ×{{ a.count }}</span>
                      }
                    </div>
                  }
                  @if (d.stats.monthlyLimit !== null) {
                    <div class="profile-monthly-bar">
                      <div class="pmb-header">
                        <span class="pmb-label">Limite mensuelle FREE</span>
                        <span class="pmb-count"
                          [class.pmb-near]="(d.stats.monthlyPercent ?? 0) >= 80 && (d.stats.monthlyPercent ?? 0) < 100"
                          [class.pmb-reached]="(d.stats.monthlyPercent ?? 0) >= 100">
                          {{ d.stats.tradesThisMonth }}/{{ d.stats.monthlyLimit }}
                        </span>
                      </div>
                      <div class="pmb-track">
                        <div class="pmb-fill"
                          [class.pmb-fill-near]="(d.stats.monthlyPercent ?? 0) >= 80 && (d.stats.monthlyPercent ?? 0) < 100"
                          [class.pmb-fill-reached]="(d.stats.monthlyPercent ?? 0) >= 100"
                          [style.width.%]="d.stats.monthlyPercent ?? 0"></div>
                      </div>
                    </div>
                  }
                </div>

                <div class="profile-section">
                  <div class="profile-section-title">⚡ Profil stratégie</div>
                  @if (d.user.tradingStyle || d.user.tradingStrategy?.length || d.user.tradingSessions?.length) {
                    <div class="profile-info-list">
                      @if (d.user.tradingStyle) {
                        <div class="profile-info-row"><span class="profile-info-label">Style</span><span class="profile-info-val">{{ styleLabel(d.user.tradingStyle) }}</span></div>
                      }
                      @if (d.user.tradingSessions?.length) {
                        <div class="profile-info-row"><span class="profile-info-label">Sessions</span><span class="profile-info-val">{{ d.user.tradingSessions!.map(s => sessionLabel(s)).join(' · ') }}</span></div>
                      }
                      @if (d.user.tradesPerDayMin !== null && d.user.tradesPerDayMin !== undefined) {
                        <div class="profile-info-row"><span class="profile-info-label">Fréquence</span><span class="profile-info-val">{{ d.user.tradesPerDayMin }}–{{ d.user.tradesPerDayMax }} trades/jour</span></div>
                      }
                      @if (d.user.tradingStrategy?.length) {
                        <div class="profile-info-row"><span class="profile-info-label">Stratégie</span>
                          <div class="profile-tags">@for (tag of d.user.tradingStrategy!; track tag) { <span class="profile-tag">{{ tag }}</span> }</div>
                        </div>
                      }
                    </div>
                    @if (d.user.strategyDescription) { <div class="profile-desc">"{{ d.user.strategyDescription }}"</div> }
                  } @else {
                    <p class="profile-empty">Profil stratégie non renseigné</p>
                  }
                </div>

                <div class="profile-section">
                  <div class="profile-section-title"><lucide-icon [img]="BotIcon" [size]="12" /> Usage IA</div>
                  <div class="profile-stats-grid">
                    <div class="profile-stat"><div class="profile-stat-label">Appels</div><div class="profile-stat-value">{{ d.stats.totalAiCalls }}</div></div>
                    <div class="profile-stat"><div class="profile-stat-label">Tokens</div><div class="profile-stat-value">{{ formatTokens(d.stats.totalTokens) }}</div></div>
                    <div class="profile-stat"><div class="profile-stat-label">Coût</div><div class="profile-stat-value">{{ d.stats.totalCostUsd | number:'1.2-2' }} USD</div></div>
                  </div>
                  @if ((d.stats.byFeature | keyvalue)?.length) {
                    <div class="profile-features">
                      @for (kv of d.stats.byFeature | keyvalue; track kv.key) {
                        <div class="profile-feature-row"><span class="profile-feature-name">{{ kv.key }}</span><span class="profile-feature-count">{{ $any(kv.value) }} appels</span></div>
                      }
                    </div>
                  }
                </div>

                <div class="profile-section">
                  <div class="profile-section-title">💳 Abonnement</div>
                  <div class="profile-info-list">
                    @if (d.user.stripeInterval) {
                      <div class="profile-info-row"><span class="profile-info-label">Type</span><span class="profile-info-val">{{ d.user.stripeInterval==='month' ? 'Mensuel' : 'Annuel' }}</span></div>
                    }
                    @if (d.user.stripeCurrentPeriodEnd) {
                      <div class="profile-info-row"><span class="profile-info-label">Expiration</span><span class="profile-info-val">{{ d.user.stripeCurrentPeriodEnd | date:'dd/MM/yyyy' }}</span></div>
                    }
                    @if (d.user.lastLoginAt) {
                      <div class="profile-info-row"><span class="profile-info-label">Dernière co.</span><span class="profile-info-val">{{ d.user.lastLoginAt | date:'dd/MM HH:mm' }}</span></div>
                    }
                    @if (d.user.startingCapital) {
                      <div class="profile-info-row"><span class="profile-info-label">Capital</span><span class="profile-info-val">{{ d.user.currency ?? 'USD' }} {{ d.user.startingCapital | number:'1.0-0' }}</span></div>
                    }
                  </div>
                </div>

                @if (d.timeline.length) {
                  <div class="profile-section">
                    <div class="profile-section-title">🕐 Activité récente</div>
                    <div class="profile-timeline">
                      @for (t of d.timeline; track t.createdAt) {
                        <div class="profile-tl-item">
                          <div class="profile-tl-dot" [class.dot-blue]="t.type==='auth'" [class.dot-purple]="t.type==='ai'" [class.dot-green]="t.type==='trade'"></div>
                          <div class="profile-tl-content"><span class="profile-tl-action">{{ t.action }}</span>@if (t.detail) { <span class="profile-tl-detail">{{ t.detail }}</span> }</div>
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
              <button class="btn-icon" (click)="closeEdit()" aria-label="Fermer"><lucide-icon [img]="XIcon" [size]="14" /></button>
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
                  <option value="STARTER">STARTER — 39€/mois</option>
                  <option value="PREMIUM">PREMIUM — 79€/mois</option>
                </select>
              </div>
              <div class="field">
                <label for="modal-edit-role">Rôle</label>
                <select id="modal-edit-role" class="field-select" [(ngModel)]="editRole">
                  <option value="USER">USER — Utilisateur standard</option>
                  <option value="BETA_TESTER">BETA_TESTER — Premium offert</option>
                  <option value="AMBASSADOR">AMBASSADOR — Programme ambassadeur</option>
                </select>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-cancel" (click)="closeEdit()">Annuler</button>
              <button class="btn-save" (click)="saveEdit()" [disabled]="saving()">{{ saving() ? 'Enregistrement…' : 'Sauvegarder' }}</button>
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
              <button class="btn-icon" (click)="closeDeleteModal()" aria-label="Fermer"><lucide-icon [img]="XIcon" [size]="14" /></button>
            </div>
            <div class="modal-body">
              <p class="delete-msg">Supprimer définitivement <strong>{{ deleteModal()!.email }}</strong> ainsi que tous ses trades et debriefs ? Cette action est irréversible.</p>
            </div>
            <div class="modal-footer">
              <button class="btn-cancel" (click)="closeDeleteModal()">Annuler</button>
              <button class="btn-save danger-btn" (click)="confirmDelete()" [disabled]="saving()">{{ saving() ? 'Suppression…' : 'Supprimer définitivement' }}</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class UsersComponent implements OnInit {
  protected readonly Trash2Icon      = Trash2;
  protected readonly PencilIcon      = Pencil;
  protected readonly XIcon           = X;
  protected readonly ShieldCheckIcon = ShieldCheck;
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
  protected readonly deleteModal = signal<AdminUser | null>(null);
  protected readonly viewingUser = signal<AdminUser | null>(null);
  protected readonly viewDetail  = signal<AdminUserDetail | null>(null);
  protected readonly viewLoading = signal(false);
  protected readonly viewError   = signal<string | null>(null);

  protected readonly totalPages = computed(() => Math.ceil(this.total() / 20) || 1);

  // ── Tri du tableau (défaut : activité = récence, plus récent en haut) ───────
  private readonly ROLE_RANK: Record<string, number> = { USER: 0, BETA_TESTER: 1, AMBASSADOR: 2, ADMIN: 3 };
  private readonly PLAN_RANK: Record<string, number> = { FREE: 0, STARTER: 1, PREMIUM: 2 };
  protected readonly sort = new TableSort<AdminUser>(
    {
      n: (u) => (u.name ?? u.email).toLowerCase(),
      role: (u) => this.ROLE_RANK[u.role] ?? 0,
      plan: (u) => this.PLAN_RANK[u.plan] ?? 0,
      act: (u) => this.actHours(u.lastSeenAt), // Jamais → +∞ (en bas)
      ses: (u) => this.sesHours(u.lastLoginAt),
      reg: (u) => new Date(u.createdAt).getTime(),
    },
    'act',
    ['ses', 'reg'], // heures/dates : plus grand d'abord
  );
  protected readonly sortedUsers = this.sort.connect(this.users);

  protected editName = '';
  protected editPlan: 'FREE' | 'STARTER' | 'PREMIUM' = 'FREE';
  protected editRole: 'USER' | 'BETA_TESTER' | 'AMBASSADOR' = 'USER';

  ngOnInit() {
    this.load();
    this.loadStats();
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page.set(1); this.load(); });
  }

  protected onSearch(value: string) { this.search.set(value); this.search$.next(value); }
  protected changePage(p: number)   { this.page.set(p); this.load(); }

  /** Sélecteur mobile « Trier par » : positionne la clé (sans inverser). */
  protected setSort(key: string) {
    if (!this.sort.isActive(key)) this.sort.toggle(key);
  }

  private actHours(lastSeenAt: string | null): number {
    if (!lastSeenAt) return Number.POSITIVE_INFINITY;
    return (Date.now() - new Date(lastSeenAt).getTime()) / 3_600_000;
  }
  private sesHours(lastLoginAt: string | null): number {
    if (!lastLoginAt) return -1;
    return (Date.now() - new Date(lastLoginAt).getTime()) / 3_600_000;
  }

  protected sessionDuration(lastLoginAt: string | null): string {
    if (!lastLoginAt) return '–';
    const totalMin = Math.floor((Date.now() - new Date(lastLoginAt).getTime()) / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h === 0 ? `${m}min` : `${h}h${m > 0 ? m + 'min' : ''}`;
  }

  protected relativeTime(dateStr: string | null): string {
    if (!dateStr) return 'Jamais';
    const min = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h}h`;
    return `il y a ${Math.floor(h / 24)}j`;
  }

  protected initials(user: AdminUser): string {
    return (user.name ?? user.email).slice(0, 2).toUpperCase();
  }

  private isFuture(dateStr: string | null): boolean {
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
    this.editRole = user.role === 'BETA_TESTER' ? 'BETA_TESTER' : user.role === 'AMBASSADOR' ? 'AMBASSADOR' : 'USER';
  }
  protected closeEdit() { this.editUser.set(null); }

  protected saveEdit() {
    const user = this.editUser();
    if (!user) return;
    this.saving.set(true);
    this.api.update(user.id, { name: this.editName || undefined, plan: this.editPlan, role: this.editRole })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => { this.users.update((list) => list.map((u) => (u.id === r.data.id ? r.data : u))); this.saving.set(false); this.closeEdit(); },
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
        next: (r) => { this.viewDetail.set(r.data); this.viewLoading.set(false); },
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
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  protected styleLabel(style: string | null | undefined): string {
    const m: Record<string, string> = { SCALPING: 'Scalping', DAY_TRADING: 'Day Trading', SWING: 'Swing', POSITION: 'Position' };
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
      next: () => { this.users.update((list) => list.filter((u) => u.id !== user.id)); this.total.update((t) => t - 1); this.saving.set(false); this.closeDeleteModal(); },
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
}
