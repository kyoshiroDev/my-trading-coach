import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReferralApi } from '../../core/api/referral.api';

@Component({
  selector: 'mtc-become-ambassador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styleUrl: './become-ambassador.component.css',
  template: `
    <div class="content">
      <a class="back" routerLink="/parrainage">← Retour au parrainage</a>

      <div class="page-head">
        <h1 class="page-title">🤝 Devenir ambassadeur</h1>
        <p class="page-sub">Tu as une audience de traders ? Touche une commission cash récurrente de 20% sur chaque abonnement de tes filleuls, tant qu'ils restent clients.</p>
      </div>

      @if (submitted()) {
        <div class="card success">
          <div class="success-ic">✓</div>
          <div class="success-t">Demande envoyée</div>
          <div class="success-d">
            Ta demande est étudiée manuellement, je reviens vers toi rapidement.
            Pas d'accès instantané : je vérifie tes réseaux avant d'activer le statut ambassadeur.
          </div>
          <a class="back-btn" routerLink="/parrainage">Revenir au parrainage</a>
        </div>
      } @else {
        <!-- Conditions -->
        <div class="card">
          <div class="elig-title">📋 Conditions</div>
          <div class="elig-list">
            <div class="elig"><span class="elig-ic">✓</span><span><b>Statut pro</b> : micro-entreprise ou société (la micro est gratuite et se crée en 15 min).</span></div>
            <div class="elig"><span class="elig-ic">✓</span><span><b>Justificatif</b> : avis de situation SIRENE, ou Kbis si société.</span></div>
            <div class="elig"><span class="elig-ic">✓</span><span><b>RIB</b> au nom de l'entreprise pour le versement.</span></div>
            <div class="elig"><span class="elig-ic">✓</span><span><b>Facture mensuelle</b> des commissions dues, payée par virement.</span></div>
          </div>
        </div>

        <!-- Formulaire -->
        <div class="card">
          <div class="elig-title">📨 Ta demande</div>
          <label class="field-lbl" for="socials">Tes réseaux sociaux <span class="req">requis</span></label>
          <input
            id="socials"
            class="field"
            type="text"
            data-testid="apply-socials"
            [value]="socials()"
            (input)="onSocials($event)"
            placeholder="Instagram, X, YouTube, Discord… (liens ou pseudos)"
          />

          <label class="field-lbl" for="message">Message <span class="opt">optionnel</span></label>
          <textarea
            id="message"
            class="field"
            rows="4"
            data-testid="apply-message"
            [value]="message()"
            (input)="onMessage($event)"
            placeholder="Parle-moi de ton audience, ta niche, pourquoi MyTradingCoach colle à ta communauté."
          ></textarea>

          @if (error()) {
            <div class="form-error">Envoi impossible pour le moment. Réessaie dans un instant.</div>
          }

          <button
            class="submit-btn"
            data-testid="apply-submit"
            [disabled]="!canSubmit() || isSubmitting()"
            (click)="submit()"
          >
            {{ isSubmitting() ? 'Envoi…' : 'Envoyer ma demande' }}
          </button>
          <div class="form-note">Validation manuelle. Aucun accès ambassadeur n'est accordé automatiquement.</div>
        </div>
      }
    </div>
  `,
})
export class BecomeAmbassadorComponent {
  private readonly api = inject(ReferralApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly socials = signal('');
  protected readonly message = signal('');
  protected readonly isSubmitting = signal(false);
  protected readonly error = signal(false);
  protected readonly submitted = signal(false);

  protected readonly canSubmit = computed(() => this.socials().trim().length >= 3);

  protected onSocials(e: Event): void { this.socials.set((e.target as HTMLInputElement).value); }
  protected onMessage(e: Event): void { this.message.set((e.target as HTMLTextAreaElement).value); }

  protected submit(): void {
    if (!this.canSubmit() || this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this.error.set(false);
    this.api
      .applyAmbassador({ socials: this.socials().trim(), message: this.message().trim() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.isSubmitting.set(false); this.submitted.set(true); },
        error: () => { this.isSubmitting.set(false); this.error.set(true); },
      });
  }
}
