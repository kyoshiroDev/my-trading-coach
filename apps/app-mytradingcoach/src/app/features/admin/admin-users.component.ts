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
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { LucideAngularModule, Search, Trash2, Pencil, X, ShieldCheck, Users } from 'lucide-angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { AdminApi, AdminUser } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-users',
  standalone: true,
  imports: [DatePipe, FormsModule, LucideAngularModule, TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin-users.component.css',
  template: `
    <mtc-topbar title="Administration — Utilisateurs" />

    <div class="content">

      <!-- Stats + search -->
      <div class="admin-toolbar">
        <div class="search-wrap">
          <lucide-icon [img]="SearchIcon" [size]="14" class="search-icon" />
          <input
            id="admin-search"
            class="search-input"
            placeholder="Rechercher par email ou nom..."
            [ngModel]="search()"
            (ngModelChange)="onSearch($event)"
            aria-label="Rechercher un utilisateur"
          />
        </div>
        <div class="admin-stats">
          <lucide-icon [img]="UsersIcon" [size]="14" />
          <span class="mono">{{ total() }} utilisateurs</span>
        </div>
      </div>

      <!-- Table -->
      @if (loading()) {
        <div class="loading-state">Chargement...</div>
      } @else if (users().length === 0) {
        <div class="empty-state">Aucun utilisateur trouvé.</div>
      } @else {
        <div class="table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th>Plan</th>
                <th>Trades</th>
                <th>Inscrit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (user of users(); track user.id) {
                <tr>
                  <td>
                    <div class="user-cell">
                      <div class="avatar">{{ initials(user) }}</div>
                      <div class="user-info">
                        <span class="user-name">{{ user.name ?? '—' }}</span>
                        <span class="user-email">{{ user.email }}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="badge role-badge" [class]="'role-' + user.role.toLowerCase()">
                      {{ user.role }}
                    </span>
                  </td>
                  <td>
                    <span class="badge plan-badge" [class]="'plan-' + user.plan.toLowerCase()">
                      {{ user.plan }}
                    </span>
                  </td>
                  <td class="mono td-center">{{ user._count.trades }}</td>
                  <td class="mono td-date">{{ user.createdAt | date:'dd/MM/yyyy' }}</td>
                  <td>
                    <div class="row-actions">
                      @if (user.role !== 'ADMIN') {
                        <button class="btn-icon" (click)="openEdit(user)" aria-label="Modifier">
                          <lucide-icon [img]="PencilIcon" [size]="13" />
                        </button>
                        <button class="btn-icon danger" (click)="openDelete(user)" aria-label="Supprimer">
                          <lucide-icon [img]="Trash2Icon" [size]="13" />
                        </button>
                      } @else {
                        <lucide-icon [img]="ShieldCheckIcon" [size]="14" color="var(--blue-bright)" />
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        @if (totalPages() > 1) {
          <div class="pagination">
            <button class="btn-page" [disabled]="page() === 1" (click)="changePage(page() - 1)">← Précédent</button>
            <span class="mono page-info">{{ page() }} / {{ totalPages() }}</span>
            <button class="btn-page" [disabled]="page() === totalPages()" (click)="changePage(page() + 1)">Suivant →</button>
          </div>
        }
      }
    </div>

    <!-- ── Edit modal ── -->
    @if (editUser()) {
      <div class="modal-overlay"
           role="button"
           tabindex="0"
           aria-label="Fermer"
           (click)="closeIfBackdrop($event, 'edit')"
           (keydown.escape)="closeEdit()">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div class="modal-header">
            <h2 id="edit-modal-title" class="modal-title">Modifier l'utilisateur</h2>
            <button class="btn-close" (click)="closeEdit()" aria-label="Fermer">
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
              <label for="edit-plan">Plan</label>
              <select id="edit-plan" class="field-select" [(ngModel)]="editPlan">
                <option value="FREE">FREE</option>
                <option value="PREMIUM">PREMIUM</option>
              </select>
            </div>

            <div class="field">
              <label for="edit-role">Rôle</label>
              <select id="edit-role" class="field-select" [(ngModel)]="editRole">
                <option value="USER">USER — Utilisateur standard</option>
                <option value="BETA_TESTER">BETA_TESTER — Premium avec restrictions IA</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" (click)="closeEdit()">Annuler</button>
            <button class="btn-save" (click)="saveEdit()" [disabled]="saving()">
              @if (saving()) { Enregistrement… } @else { Sauvegarder }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Delete confirm ── -->
    @if (deleteUser()) {
      <div class="modal-overlay"
           role="button"
           tabindex="0"
           aria-label="Fermer"
           (click)="closeIfBackdrop($event, 'delete')"
           (keydown.escape)="closeDelete()">
        <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div class="modal-header">
            <h2 id="delete-modal-title" class="modal-title danger-title">Supprimer l'utilisateur</h2>
            <button class="btn-close" (click)="closeDelete()" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="14" />
            </button>
          </div>
          <div class="modal-body">
            <p class="delete-msg">
              Supprimer définitivement <strong>{{ deleteUser()!.email }}</strong> ainsi que
              tous ses trades et debriefs ? Cette action est irréversible.
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel" (click)="closeDelete()">Annuler</button>
            <button class="btn-danger" (click)="confirmDelete()" [disabled]="saving()">
              @if (saving()) { Suppression… } @else { Confirmer la suppression }
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminUsersComponent implements OnInit {
  protected readonly SearchIcon = Search;
  protected readonly Trash2Icon = Trash2;
  protected readonly PencilIcon = Pencil;
  protected readonly XIcon = X;
  protected readonly ShieldCheckIcon = ShieldCheck;
  protected readonly UsersIcon = Users;

  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly search$ = new Subject<string>();

  protected readonly users = signal<AdminUser[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly search = signal('');
  protected readonly editUser = signal<AdminUser | null>(null);
  protected readonly deleteUser = signal<AdminUser | null>(null);

  protected readonly totalPages = computed(() => Math.ceil(this.total() / 20) || 1);

  protected editName = '';
  protected editPlan: 'FREE' | 'PREMIUM' = 'FREE';
  protected editRole: 'USER' | 'BETA_TESTER' = 'USER';

  ngOnInit() {
    this.load();
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => { this.page.set(1); this.load(); });
  }

  protected onSearch(value: string) { this.search.set(value); this.search$.next(value); }
  protected changePage(p: number) { this.page.set(p); this.load(); }

  protected initials(user: AdminUser): string {
    return (user.name ?? user.email).slice(0, 2).toUpperCase();
  }

  protected closeIfBackdrop(event: MouseEvent, modal: 'edit' | 'delete') {
    if (event.target !== event.currentTarget) return;
    if (modal === 'edit') { this.closeEdit(); } else { this.closeDelete(); }
  }

  private load() {
    this.loading.set(true);
    this.api.list(this.page(), 20, this.search() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.users.set(res.data.users);
          this.total.set(res.data.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
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
    this.api.update(user.id, {
      name: this.editName || undefined,
      plan: this.editPlan,
      role: this.editRole,
    }).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.users.update((list) => list.map((u) => u.id === res.data.id ? res.data : u));
          this.saving.set(false);
          this.closeEdit();
        },
        error: () => this.saving.set(false),
      });
  }

  protected openDelete(user: AdminUser) { this.deleteUser.set(user); }
  protected closeDelete() { this.deleteUser.set(null); }

  protected confirmDelete() {
    const user = this.deleteUser();
    if (!user) return;
    this.saving.set(true);
    this.api.delete(user.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.users.update((list) => list.filter((u) => u.id !== user.id));
          this.total.update((t) => t - 1);
          this.saving.set(false);
          this.closeDelete();
        },
        error: () => this.saving.set(false),
      });
  }
}
