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
import { LucideAngularModule, Check } from 'lucide-angular';
import { ReferralApi } from '../../core/api/referral.api';

@Component({
  selector: 'mtc-become-ambassador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule],
  styleUrl: './become-ambassador.component.css',
  template: `
    <div class="content">
      <a class="back" routerLink="/parrainage">← Retour au parrainage</a>

      <h1 class="page-title">🤝 Devenir ambassadeur</h1>
      <p class="page-sub">Tu as une audience de traders ? Touche une commission cash récurrente de 20% sur chaque abonnement de tes filleuls, tant qu'ils restent clients.</p>

      @if (submitted()) {
        <div class="card success">
          <div class="success-ic"><lucide-icon [img]="CheckIcon" [size]="22" /></div>
          <div class="success-t">Demande envoyée</div>
          <div class="success-d">
            Ta demande est étudiée manuellement, je reviens vers toi rapidement.
            Pas d'accès instantané : je vérifie tes réseaux avant d'activer le statut ambassadeur.
          </div>
          <a class="back-btn" routerLink="/parrainage">Revenir au parrainage</a>
        </div>
      } @else {
        <!-- 20% (pleine largeur) -->
        <div class="comm">
          <div class="comm-pct">20%</div>
          <div class="comm-body">
            <div class="comm-txt"><b>de commission récurrente</b> sur chaque paiement de tes filleuls. Versée chaque mois, tant qu'ils restent abonnés, pas seulement au premier mois.</div>
            <span class="comm-pill">RÉCURRENT · TANT QUE LE FILLEUL RESTE ABONNÉ</span>
          </div>
        </div>

        <!-- Conditions (pleine largeur, items en 2 colonnes) -->
        <div class="card">
          <div class="card-title">📋 Conditions</div>
          <div class="elig-grid">
            <div class="elig"><span class="elig-ic"><lucide-icon [img]="CheckIcon" [size]="12" /></span><span><b>Statut pro</b> : micro-entreprise ou société (la micro est gratuite et se crée en 15 min).</span></div>
            <div class="elig"><span class="elig-ic"><lucide-icon [img]="CheckIcon" [size]="12" /></span><span><b>Justificatif</b> : avis de situation SIRENE, ou Kbis si société.</span></div>
            <div class="elig"><span class="elig-ic"><lucide-icon [img]="CheckIcon" [size]="12" /></span><span><b>RIB</b> au nom de l'entreprise pour le versement.</span></div>
            <div class="elig"><span class="elig-ic"><lucide-icon [img]="CheckIcon" [size]="12" /></span><span><b>Facture mensuelle</b> des commissions dues, payée par virement.</span></div>
          </div>
        </div>

        <!-- 2 colonnes alignées : comment ça marche | ta demande -->
        <div class="grid">
          <div class="card">
            <div class="card-title">Comment ça marche</div>
            <div class="vstep"><div class="n">1</div><div><h4>Partage ton lien</h4><p>À ta communauté, sur tes contenus. Le code est attribué automatiquement à l'inscription.</p></div></div>
            <div class="vstep"><div class="n">2</div><div><h4>Ton filleul s'abonne</h4><p>Il passe Premium. Rien n'est dû tant qu'il est en essai.</p></div></div>
            <div class="vstep"><div class="n">3</div><div><h4>Tu touches 20%</h4><p>Sur chaque paiement, chaque mois, tant qu'il reste client. Tu factures, on te paie par virement.</p></div></div>
          </div>

          <div class="card">
            <div class="card-title">📨 Ta demande</div>
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

            <div class="field-row">
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
            </div>

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
        </div>
      }
    </div>
  `,
})
export class BecomeAmbassadorComponent {
  private readonly api = inject(ReferralApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly CheckIcon = Check;

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
