import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DialogDirective } from '@mtc/front-ui';
import { InstallPromptService } from '../../core/install/install-prompt.service';
import { PushService } from '../../core/push/push.service';
import { PUSH_BROWSER } from '../../core/push/push-browser';
import { UserStore } from '../../core/stores/user.store';
import { ToastService } from '../../core/services/toast.service';

/** Exemples de l'écran verrouillé : les VRAIS textes des notifications branchées, sans montant. */
export const LOCK_SCREEN_EXAMPLES = [
  { when: 'maintenant', text: 'Apex 50K · Il reste moins de 10\u00a0% de ta perte max du jour (estimation MyTradingCoach).' },
  { when: '17:30', text: 'Récap du jour · Ton récap du jour est prêt.' },
  { when: 'hier', text: 'Connexion Tradovate à renouveler · Synchro interrompue pour Apex 50K\u00a0: reconnecte-le depuis Comptes.' },
] as const;

/** Appli dont le navigateur intégré est ouvert, pour le texte « il faut quitter … ». */
function inAppName(ua: string): string {
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook';
  if (/musical_ly|BytedanceWebview/i.test(ua)) return 'TikTok';
  if (/Twitter/i.test(ua)) return 'X';
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
  return 'cette application';
}

/**
 * Feuille d'installation (maquette `mockup-installation-pwa.html`), chargée à la demande par `App`
 * quand `InstallPromptService.sheet()` s'ouvre. Contenu selon l'appareil : invite du navigateur
 * (Android, ordinateur), trois étapes (iPhone Safari), ouvrir Safari (iPhone sur Chrome ou
 * Firefox), ouvrir le navigateur (Instagram, X, TikTok). Après installation : invitation aux
 * alertes, vers la section Notifications du Profil (aucune permission demandée ici).
 */
@Component({
  selector: 'mtc-install-sheet',
  imports: [DialogDirective],
  templateUrl: './install-sheet.component.html',
  styleUrl: './install-sheet.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallSheetComponent implements OnInit {
  protected readonly install = inject(InstallPromptService);
  private readonly push = inject(PushService);
  private readonly browser = inject(PUSH_BROWSER);
  private readonly userStore = inject(UserStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly examples = LOCK_SCREEN_EXAMPLES;
  protected readonly state = this.install.state;
  protected readonly sheet = this.install.sheet;
  protected readonly isPremium = this.userStore.isPremium;
  /** Invitation aux alertes : affichée seulement une fois le push vérifié (`supported`). */
  protected readonly pushReady = signal(false);
  /** « Je l'ai fait » sans mode application : on dit d'ouvrir l'icône. */
  protected readonly iosOpenIcon = signal(false);
  protected readonly appName = inAppName(this.browser.env().userAgent);
  /** iPhone : flèche vers Partager, en bas de Safari (sur iPad, Partager est en haut). */
  protected readonly showArrow = /iPhone|iPod/.test(this.browser.env().userAgent);
  protected readonly isDesktop = this.install.place() === 'desktop';
  protected readonly clock = computed(() => {
    const d = new Date();
    return {
      time: d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      date: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  });

  async ngOnInit(): Promise<void> {
    if (this.sheet() !== 'push') return;
    // Push coupé côté serveur (GET /push/settings → enabled: false), refusé, déjà actif : rien.
    await this.push.init({ readOnly: this.userStore.isDemo() });
    const st = this.push.state();
    if (st === 'supported') this.pushReady.set(true);
    else this.install.pushNotNeeded(st === 'subscribed');
  }

  protected later(): void {
    this.install.later();
  }

  protected never(): void {
    this.install.never();
  }

  protected async installNow(): Promise<void> {
    await this.install.install();
  }

  protected iosDone(): void {
    if (!this.install.iosDone()) this.iosOpenIcon.set(true);
  }

  protected async copyLink(): Promise<void> {
    const url = `${location.origin}/dashboard`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Lien copié');
    } catch {
      this.toast.info(`Copie ce lien\u00a0: ${url}`);
    }
  }

  /** « Activer les alertes » : la section Notifications du Profil, qui explique puis demande. */
  protected goToNotifications(): void {
    this.install.close();
    void this.router.navigate(['/profil'], { fragment: 'notifications' });
  }
}
