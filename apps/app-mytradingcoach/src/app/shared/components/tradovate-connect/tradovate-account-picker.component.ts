import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { TradovateExternalAccount } from '../../../core/api/tradovate.api';

/**
 * Choix du compte Tradovate à synchroniser quand un même login en porte plusieurs (cas réel
 * vérifié en beta : un compte réel + un compte simulé). Un TradingAccount MTC = UN compte
 * Tradovate : l'utilisateur choisit lequel alimente ce compte.
 */
@Component({
  selector: 'mtc-tradovate-account-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tvp" data-testid="tradovate-account-picker">
      <p class="tvp-q">Plusieurs comptes Tradovate sont liés à ces identifiants. Lequel synchroniser ici&nbsp;?</p>
      <div class="tvp-list" role="radiogroup">
        @for (a of accounts(); track a.id) {
          <label class="tvp-opt" [class.sel]="choice() === a.id">
            <input type="radio" name="tvp" [value]="a.id" [checked]="choice() === a.id"
                   (change)="choice.set(a.id)" [attr.data-testid]="'tradovate-pick-' + a.id" />
            <span class="tvp-name">{{ a.name }}</span>
            <span class="tvp-env">{{ a.env === 'demo' ? 'Compte simulé · prop firm ou démo' : 'Compte réel' }}</span>
          </label>
        }
      </div>
      <button class="tvp-btn" type="button" data-testid="tradovate-pick-confirm"
              [disabled]="!choice() || busy()" (click)="picked.emit(choice()!)">
        {{ busy() ? 'Synchronisation…' : 'Synchroniser ce compte' }}
      </button>
    </div>
  `,
  styleUrl: './tradovate-account-picker.component.css',
})
export class TradovateAccountPickerComponent {
  readonly accounts = input.required<TradovateExternalAccount[]>();
  readonly busy = input(false);
  readonly picked = output<string>();
  protected readonly choice = signal<string | null>(null);
}
