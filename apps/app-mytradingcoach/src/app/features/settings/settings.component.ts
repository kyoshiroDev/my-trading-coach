import {
  ChangeDetectionStrategy, Component, OnInit, inject, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import type { UpdatePreferencesDto } from '../../core/api/users.api';

@Component({
  selector: 'mtc-settings',
  standalone: true,
  imports: [TopbarComponent, DatePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  protected readonly userStore = inject(UserStore);
  private readonly auth = inject(AuthService);
  private readonly billingApi = inject(BillingApi);
  private readonly usersApi = inject(UsersApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly checkoutParam = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('checkout'))),
  );

  // Compte — nom
  protected readonly editingName = signal(false);
  protected readonly nameInput = signal('');
  protected readonly isSavingName = signal(false);

  // Compte — email
  protected readonly editingEmail = signal(false);
  protected readonly emailInput = signal('');
  protected readonly isSavingEmail = signal(false);

  // Compte — mot de passe
  protected readonly passwordResetSent = signal(false);

  // Préférences
  protected readonly prefCurrency = signal<'USD' | 'EUR' | 'GBP'>('USD');
  protected readonly prefNotifications = signal(true);
  protected readonly prefDebrief = signal(true);
  protected readonly isSavingPrefs = signal(false);
  protected readonly prefSaved = signal(false);

  // Danger
  protected readonly showDeleteConfirm = signal(false);
  protected readonly deleteInput = signal('');
  protected readonly isDeleting = signal(false);

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('checkout') === 'success') {
      this.userStore.refreshUser();
    }
    const user = this.userStore.user();
    if (user) {
      this.prefCurrency.set((user.currency as 'USD' | 'EUR' | 'GBP') ?? 'USD');
      this.prefNotifications.set(user.notificationsEmail ?? true);
      this.prefDebrief.set(user.debriefAutomatic ?? true);
    }
  }

  protected startTrial(plan: 'monthly' | 'yearly' = 'monthly') {
    this.billingApi.checkout(plan).subscribe({
      next: (res) => { window.location.href = res.data.url; },
    });
  }

  protected openPortal() {
    this.billingApi.portal().subscribe({
      next: (res) => { window.location.href = res.data.url; },
    });
  }

  protected startEditEmail() {
    this.emailInput.set(this.userStore.user()?.email ?? '');
    this.editingEmail.set(true);
  }

  protected saveEmail() {
    const email = this.emailInput().trim();
    if (!email) return;
    this.isSavingEmail.set(true);
    this.usersApi.updateMe({ email }).subscribe({
      next: (res) => {
        this.auth.currentUser.set(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        this.editingEmail.set(false);
        this.isSavingEmail.set(false);
      },
      error: () => { this.isSavingEmail.set(false); },
    });
  }

  protected startEditName() {
    this.nameInput.set(this.userStore.user()?.name ?? '');
    this.editingName.set(true);
  }

  protected saveName() {
    const name = this.nameInput().trim();
    if (!name) return;
    this.isSavingName.set(true);
    this.usersApi.updateMe({ name }).subscribe({
      next: (res) => {
        this.auth.currentUser.set(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        this.editingName.set(false);
        this.isSavingName.set(false);
      },
      error: () => { this.isSavingName.set(false); },
    });
  }

  protected resetPassword() {
    const user = this.userStore.user();
    if (!user) return;
    this.auth.forgotPassword(user.email).subscribe({
      next: () => {
        this.passwordResetSent.set(true);
        setTimeout(() => this.passwordResetSent.set(false), 4000);
      },
      error: () => {},
    });
  }

  protected savePreferences() {
    this.isSavingPrefs.set(true);
    const dto: UpdatePreferencesDto = {
      currency: this.prefCurrency(),
      notificationsEmail: this.prefNotifications(),
      debriefAutomatic: this.prefDebrief(),
    };
    this.usersApi.updatePreferences(dto).subscribe({
      next: (res) => {
        this.auth.currentUser.set(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        this.isSavingPrefs.set(false);
        this.prefSaved.set(true);
        setTimeout(() => this.prefSaved.set(false), 2500);
      },
      error: () => { this.isSavingPrefs.set(false); },
    });
  }

  protected confirmDelete() {
    if (this.deleteInput() !== 'SUPPRIMER') return;
    this.isDeleting.set(true);
    this.usersApi.deleteMe().subscribe({
      next: () => { this.auth.logout(); },
      error: () => { this.isDeleting.set(false); },
    });
  }
}
