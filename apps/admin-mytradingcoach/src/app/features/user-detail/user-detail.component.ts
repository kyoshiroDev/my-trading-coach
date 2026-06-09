import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { httpResource } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserDetailData } from '../../core/api/admin.api';

@Component({
  selector: 'mtc-admin-user-detail',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './user-detail.component.css',
  template: `
    <div class="screen">
      <a class="back-link" routerLink="/users">← Utilisateurs</a>

      @if (detail.isLoading()) {
        <div class="card"><div class="empty">Chargement…</div></div>
      } @else if (detail.error()) {
        <div class="card"><div class="empty">⚠ Utilisateur introuvable</div></div>
      } @else if (data(); as d) {
        <div class="card"><div class="card-body">{{ d.identity.name ?? d.identity.email }}</div></div>
      }
    </div>
  `,
})
export class UserDetailComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly id = toSignal(
    this.route.paramMap.pipe(map((p) => p.get('id') ?? '')),
    { initialValue: '' },
  );

  protected readonly detail = httpResource<{ data: UserDetailData }>(() => {
    const id = this.id();
    return id ? `${environment.apiUrl}/admin/users/${id}` : undefined;
  });

  protected readonly data = computed(() => this.detail.value()?.data ?? null);
}
