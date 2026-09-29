import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent } from '@mtc/front-ui';

@Component({
  selector: 'mtc-admin-root',
  imports: [RouterOutlet, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Dialogue de confirmation monté une fois, hors du routeur.
  template: `<router-outlet /><mtc-confirm-dialog />`,
})
export class AppComponent {}
