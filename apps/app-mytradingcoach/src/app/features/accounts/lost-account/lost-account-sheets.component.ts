import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { DialogDirective } from '@mtc/front-ui';
import { LostAccountFlowService, type LostAccountChoice } from '@app/core/services/lost-account-flow.service';

/**
 * Feuilles du compte perdu, montées une fois dans la coque connectée (sidebar) : « que faire de ce
 * compte ? » (écran 2 de la maquette) et « Repartir sur une nouvelle tentative » (écran 4).
 * Feuille en bas d'écran sur téléphone, boîte centrée sur ordinateur.
 */
@Component({
  selector: 'mtc-lost-account-sheets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogDirective],
  templateUrl: './lost-account-sheets.component.html',
  styleUrl: './lost-account-sheets.component.css',
})
export class LostAccountSheetsComponent {
  protected readonly flow = inject(LostAccountFlowService);

  /** Choix coché : « Archiver » par défaut (recommandé), remis à chaque ouverture. */
  protected readonly choice = signal<LostAccountChoice>('archive');

  constructor() {
    effect(() => {
      this.flow.choiceId();
      untracked(() => this.choice.set('archive'));
    });
  }

  protected confirm(): void {
    void this.flow.confirmChoice(this.choice());
  }
}
