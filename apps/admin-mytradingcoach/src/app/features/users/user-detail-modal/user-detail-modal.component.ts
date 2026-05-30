import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AdminUser, AdminUserDetail } from '../../../core/api/admin.api';

/** Modal de détail utilisateur — extraction de users.component.ts */
@Component({
  selector: 'mtc-admin-user-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<!-- Template à extraire de users.component.ts @if (viewingUser()) block -->`,
})
export class UserDetailModalComponent {
  readonly user    = input<AdminUser | null>(null);
  readonly detail  = input<AdminUserDetail | null>(null);
  readonly loading = input(false);
  readonly error   = input<string | null>(null);

  readonly modalClose    = output<void>();
  readonly changePlan    = output<{ userId: string; plan: string }>();
  readonly resetPassword = output<string>();
  readonly banUser       = output<string>();
}
