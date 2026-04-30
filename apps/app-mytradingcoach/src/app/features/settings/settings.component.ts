import {
  ChangeDetectionStrategy, Component, OnInit, effect, inject, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import type { UpdatePreferencesDto } from '../../core/api/users.api';

@Component({
  selector: 'mtc-settings',
  standalone: true,
  imports: [TopbarComponent, DatePipe, PlanModalComponent],
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

  // Compte — capital de départ
  protected readonly editingCapital = signal(false);
  protected readonly capitalInput = signal('');
  protected readonly isSavingCapital = signal(false);

  // Préférences
  protected readonly prefCurrency = signal<'USD' | 'EUR' | 'GBP'>('USD');
  protected readonly prefNotifications = signal(true);
  protected readonly prefDebrief = signal(true);
  protected readonly isSavingPrefs = signal(false);
  protected readonly prefSaved = signal(false);

  // Danger
  protected readonly showPlanModal = signal(false);
  protected readonly showDeleteConfirm = signal(false);
  protected readonly deleteInput = signal('');
  protected readonly isDeleting = signal(false);

  constructor() {
    // Sync réactive : se met à jour si le user change (retour d'onglet, refresh)
    effect(() => {
      const user = this.userStore.user();
      if (!user) return;
      this.prefCurrency.set((user.currency as 'USD' | 'EUR' | 'GBP') ?? 'USD');
      this.prefNotifications.set(user.notificationsEmail ?? true);
      this.prefDebrief.set(user.debriefAutomatic ?? true);
    });
  }

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('checkout') === 'success') {
      this.userStore.refreshUser();
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
        this.auth.setCurrentUser(res.data);
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
        this.auth.setCurrentUser(res.data);
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
      error: () => { /* silently ignore — user stays on page */ },
    });
  }

  protected startEditCapital() {
    const current = this.userStore.startingCapital();
    this.capitalInput.set(current > 0 ? String(current) : '');
    this.editingCapital.set(true);
  }

  protected filterCapital(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    this.capitalInput.set(input.value);
  }

  protected saveCapital() {
    const raw = this.capitalInput().replace(',', '.');
    const parsed = parseFloat(raw);
    const capital = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    this.isSavingCapital.set(true);
    this.usersApi.updatePreferences({ startingCapital: capital }).subscribe({
      next: (res) => {
        this.auth.setCurrentUser(res.data);
        this.isSavingCapital.set(false);
        this.editingCapital.set(false);
      },
      error: () => { this.isSavingCapital.set(false); },
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
        this.auth.setCurrentUser(res.data);
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
