import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { environment } from '@app/environments/environment';

const landing = environment.landingUrl.replace(/\/$/, '');

/**
 * Mention d'acceptation des CGU et de la majorité, au-dessus de chaque bouton qui CRÉE un compte
 * (#745, F2). L'API enregistre la date et la version acceptées à la création (`CGU_VERSION`) : la
 * mention doit donc être visible avant le clic, y compris sur « Continuer avec Google » de la page
 * de connexion, qui crée le compte au premier passage.
 */
@Component({
  selector: 'mtc-signup-terms-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./signup-terms-note.component.css'],
  templateUrl: './signup-terms-note.component.html',
})
export class SignupTermsNoteComponent {
  /** `email` : bouton du formulaire · `google` : inscription Google · `google-login` : page de connexion. */
  readonly variant = input<'email' | 'google' | 'google-login'>('email');

  protected readonly cguUrl = `${landing}/cgu`;
  protected readonly privacyUrl = `${landing}/politique-confidentialite`;
}
