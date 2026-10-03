import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import type { TradovateExternalAccount } from '@app/core/api/tradovate.api';

/**
 * Choix du compte Tradovate à synchroniser. Toujours affiché à la première connexion, même
 * pour un compte unique : rien n'est importé avant confirmation (mauvais login, compte voisin
 * écarté…). Un TradingAccount MTC = UN compte Tradovate : l'utilisateur choisit lequel
 * alimente ce compte. Un compte unique est présélectionné.
 */
@Component({
  selector: 'mtc-tradovate-account-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tvp" data-testid="tradovate-account-picker">
      @if (accounts().length > 1) {
        <p class="tvp-q">Plusieurs comptes Tradovate sont liés à ces identifiants. Lequel synchroniser ici&nbsp;?</p>
      } @else {
        <p class="tvp-q">Vérifie que c'est bien le compte Tradovate à synchroniser ici&nbsp;: rien n'est importé avant ta confirmation.</p>
      }
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
  // Compte unique présélectionné : confirmer reste un geste explicite, sans clic inutile.
  protected readonly choice = linkedSignal<string | null>(() => {
    const list = this.accounts();
    return list.length === 1 ? list[0].id : null;
  });
}
