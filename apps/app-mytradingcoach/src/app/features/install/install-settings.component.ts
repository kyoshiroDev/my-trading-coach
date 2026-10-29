import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { InstallPromptService } from '../../core/install/install-prompt.service';

/**
 * Point d'entrée permanent du Profil (onglet Paramètres, maquette n° 5) : « Installer l'app »
 * rouvre le parcours de l'appareil, même après « Plus tard » ou « Ne plus me proposer ». Une fois
 * installée : « App installée ». Absente là où aucune installation n'est possible (ordinateur sans
 * invite du navigateur).
 */
@Component({
  selector: 'mtc-install-settings',
  templateUrl: './install-settings.component.html',
  styleUrl: './install-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallSettingsComponent {
  protected readonly install = inject(InstallPromptService);
  protected readonly state = this.install.state;
}
