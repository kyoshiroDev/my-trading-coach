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
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import {
  LucideDynamicIcon,
  LucideTrash2 as Trash2,
  LucidePencil as Pencil,
  LucideX as X,
  LucideShieldCheck as ShieldCheck,
} from '@lucide/angular';
import { AdminApi, AdminUser, AdminStats } from '../../core/api/admin.api';
import { TableSort } from '../../shared/tables/table-sort';
import { PRICING_EUR } from '../../core/constants/pricing.const';
import type { Plan } from '@mtc/shared';
import { DialogDirective } from '@mtc/front-ui';

@Component({
  selector: 'mtc-admin-users',
  imports: [DialogDirective, DatePipe, FormsModule, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './users.component.css',
  templateUrl: './users.component.html',
})
export class UsersComponent implements OnInit {
  protected readonly Trash2Icon      = Trash2;
  protected readonly PencilIcon      = Pencil;
  protected readonly XIcon           = X;
  protected readonly ShieldCheckIcon = ShieldCheck;
  protected readonly pricing = PRICING_EUR;

  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
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

  protected readonly totalPages = computed(() => Math.ceil(this.total() / 20) || 1);

  // ── Tri du tableau (défaut : activité = récence, plus récent en haut) ───────
  private readonly ROLE_RANK: Record<string, number> = { USER: 0, BETA_TESTER: 1, AMBASSADOR: 2, ADMIN: 3 };
  private readonly PLAN_RANK: Record<string, number> = { FREE: 0, PREMIUM: 1 };
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
  protected editPlan: Plan = 'FREE';
  protected editRole: 'USER' | 'BETA_TESTER' | 'AMBASSADOR' = 'USER';

  ngOnInit() {
    this.load();
    this.loadStats();
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page.set(1); this.load(); });
  }

  protected onSearch(value: string) { this.search.set(value); this.search$.next(value); }
  protected changePage(p: number)   { this.page.set(p); this.load(); }

  /** Clic sur une ligne → fiche utilisateur. */
  protected goToDetail(id: string) { this.router.navigate(['/users', id]); }

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
    if (!lastLoginAt) return '-';
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
    return ({ trial: 'Essai', annual: 'Annuel', monthly: 'Mensuel', manual: 'Manuel' })[this.subType(user)] ?? '-';
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
