import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideDynamicIcon, LucideCoins as Coins } from '@lucide/angular';

/**
 * « Tous les comptes » avec des devises différentes : à la place des totaux (KPI,
 * courbes, calendrier), qui additionneraient des USD et des EUR. Les lignes de trades, elles,
 * restent affichées, chacune dans la devise de son compte.
 */
@Component({
  selector: 'mtc-mixed-currency-notice',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mixed-currency-notice.component.css',
  template: `
    <div class="mcn" role="status" data-testid="mixed-currency-notice">
      <svg [lucideIcon]="CoinsIcon" [size]="16" class="mcn-ic"></svg>
      <div>
        <div class="mcn-title">Comptes en devises différentes : choisis un compte</div>
        <div class="mcn-sub">
          Chaque compte s'affiche dans sa propre devise, sans conversion. Choisis un compte dans le
          sélecteur en haut pour voir ses totaux.
        </div>
      </div>
    </div>
  `,
})
export class MixedCurrencyNoticeComponent {
  protected readonly CoinsIcon = Coins;
}
