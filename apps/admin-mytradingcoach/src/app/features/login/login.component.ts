import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminAuthService } from '../../core/auth/admin-auth.service';

@Component({
  selector: 'mtc-admin-login',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <div class="logo-mark">M</div>
          <span class="logo-text">MTC Admin</span>
        </div>
        <h1 class="login-title">Connexion</h1>
        <p class="login-sub">Accès réservé aux administrateurs</p>
        @if (error()) {
          <div class="login-error">{{ error() }}</div>
        }
        <form (ngSubmit)="submit()">
          <div class="field">
            <label class="label">Email</label>
            <input type="email" [(ngModel)]="email" name="email" placeholder="admin@mytradingcoach.app" required />
          </div>
          <div class="field">
            <label class="label">Mot de passe</label>
            <input type="password" [(ngModel)]="password" name="password" placeholder="••••••••••" required />
          </div>
          <button type="submit" class="btn-login" [disabled]="loading()">
            @if (loading()) { Connexion… } @else { Se connecter }
          </button>
        </form>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AdminAuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected email = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  submit() {
    if (!this.email || !this.password) return;
    this.loading.set(true);
    this.error.set(null);
    this.auth.login(this.email, this.password)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.router.navigate(['/dashboard']),
        error: (err) => {
          this.error.set(err.error?.message ?? 'Identifiants incorrects');
          this.loading.set(false);
        },
      });
  }
}
