import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SIGNUP_PITCH_POINTS } from '@mtc/shared';
import { AuthPreviewComponent } from './auth-preview.component';

/** Colonne de présentation de `/register` et `/login` : statique, aucun appel API. */
@Component({
  selector: 'mtc-auth-pitch',
  imports: [AuthPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-pitch.component.css',
  templateUrl: './auth-pitch.component.html',
})
export class AuthPitchComponent {
  protected readonly points = SIGNUP_PITCH_POINTS;
}
