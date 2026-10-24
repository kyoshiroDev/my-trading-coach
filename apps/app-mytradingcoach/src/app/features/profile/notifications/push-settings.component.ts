import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideDynamicIcon, LucideLock as Lock } from '@lucide/angular';
import { PUSH_MAX_DEVICES, type PushAlertType } from '@mtc/shared';
import { PushService } from '../../../core/push/push.service';
import { PUSH_BROWSER } from '../../../core/push/push-browser';
import { UserStore } from '../../../core/stores/user.store';
import { ToastService } from '../../../core/services/toast.service';
import { PlanModalComponent } from '../../../shared/components/plan-modal/plan-modal.component';

/** Une ligne « Ce que tu reçois » (textes de la maquette `mockup-push.html`). */
export interface PushTypeRow {
  type: PushAlertType;
  label: string;
  hint: string;
  /** Quand l'alerte part (dit honnêtement, #666). */
  delay?: string;
  premium: boolean;
}

export const PUSH_TYPE_ROWS: readonly PushTypeRow[] = [
  {
    type: 'PROP_RULES',
    label: 'Limites et objectifs',
    hint: 'Marge sous 10 %, limite franchie, objectif atteint, payout possible.',
    delay: 'En direct si MTC est ouvert. Sinon, relevé de la synchro automatique, jusqu’à 15 min de décalage.',
    premium: true,
  },
  {
    type: 'BEHAVIOR',
    label: 'Comportement',
    hint: 'Anti-tilt et alertes de comportement.',
    delay: 'Seulement en direct, pendant que MTC est ouvert.',
    premium: true,
  },
  { type: 'RECAP', label: 'Récap du jour', hint: 'Ton récap de 17h30 est prêt.', premium: true },
  { type: 'CONNECTION', label: 'Reconnexion Tradovate', hint: 'Quand ta connexion expire.', premium: false },
];

/** Heures silencieuses proposées à l'activation (heure de Paris). */
const DEFAULT_QUIET = { start: 22 * 60, end: 7 * 60 };

export const toHhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const fromHhmm = (value: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
};

/**
 * Section « Notifications » du profil (#666 phase 2). Structure et textes : maquette
 * `maquettes/mockup-push.html` (6 états + bureau). Chargée à la demande (`@defer` dans le profil).
 * Masquée sans erreur si le push est coupé côté serveur ; lecture seule pour le compte démo.
 */
@Component({
  selector: 'mtc-push-settings',
  standalone: true,
  imports: [LucideDynamicIcon, PlanModalComponent],
  templateUrl: './push-settings.component.html',
  styleUrl: './push-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushSettingsComponent implements OnInit {
  protected readonly push = inject(PushService);
  protected readonly userStore = inject(UserStore);
  private readonly toast = inject(ToastService);
  private readonly browser = inject(PUSH_BROWSER);

  protected readonly LockIcon = Lock;
  protected readonly rows = PUSH_TYPE_ROWS;
  protected readonly maxDevices = PUSH_MAX_DEVICES;
  protected readonly showPlanModal = signal(false);
  protected readonly testing = signal(false);

  protected readonly readOnly = this.userStore.isDemo;
  protected readonly premium = this.userStore.isPremium;
  protected readonly state = this.push.state;
  protected readonly settings = this.push.settings;
  protected readonly devices = computed(() => this.settings()?.devices ?? []);
  protected readonly currentDevice = computed(() => this.devices().find((d) => d.id === this.push.currentDeviceId()) ?? null);
  protected readonly quiet = computed(() => this.settings()?.quietHours ?? null);
  /** Réglages en vigueur affichés : appareil abonné, ou compte démo (lecture seule). */
  protected readonly active = computed(() => this.readOnly() || this.state() === 'subscribed');
  /** La liste des types se montre aussi avant l'abonnement (« Ce que tu recevras »). */
  protected readonly showsTypes = computed(() => {
    const st = this.state();
    return this.active() || st === 'supported' || st === 'ios-not-installed';
  });
  /** « ce téléphone » ou « cet ordinateur », pour le premier réglage. */
  protected readonly deviceNoun = computed(() =>
    /Android|iPhone|iPad|iPod|Mobile/i.test(this.browser.env().userAgent) ? 'ce téléphone' : 'cet ordinateur',
  );

  ngOnInit(): void {
    void this.push.init({ readOnly: this.readOnly() }).then(() => {
      // Ouverte par le lien « Réglages » d'une notification (`/profil#notifications`).
      if (typeof location !== 'undefined' && location.hash === '#notifications') {
        setTimeout(() => document.getElementById('notifications')?.scrollIntoView({ block: 'start' }));
      }
    });
  }

  /** Ligne utilisable : appareil abonné, pas en démo, et type compris dans le plan. */
  protected rowLocked(row: PushTypeRow): boolean {
    return row.premium && !this.premium();
  }

  protected rowDisabled(row: PushTypeRow): boolean {
    return this.readOnly() || this.state() !== 'subscribed' || this.rowLocked(row) || this.push.busy();
  }

  /** Ce que l'interrupteur montre : l'état réel, et « coupé » pour une ligne verrouillée. */
  protected rowOn(row: PushTypeRow): boolean {
    if (this.state() === 'ios-not-installed') return false;
    return !this.rowLocked(row) && this.push.isTypeEnabled(row.type);
  }

  protected async toggleRow(row: PushTypeRow): Promise<void> {
    if (this.rowDisabled(row)) return;
    // `failed` une seule fois par échec : les changements abandonnés derrière lui (`skipped`) restent muets.
    if ((await this.push.setTypeEnabled(row.type, !this.rowOn(row))) === 'failed') this.toast.error('Ton réglage n’a pas pu être enregistré. Réessaie.');
  }

  protected async toggleQuiet(): Promise<void> {
    if (this.readOnly()) return;
    if ((await this.push.setQuietHours(this.quiet() ? null : DEFAULT_QUIET)) === 'failed') this.toast.error('Les heures silencieuses n’ont pas pu être enregistrées.');
  }

  protected async changeQuiet(edge: 'start' | 'end', value: string): Promise<void> {
    const current = this.quiet();
    const minutes = fromHhmm(value);
    if (!current || minutes === null || this.readOnly()) return;
    if ((await this.push.setQuietHours({ ...current, [edge]: minutes })) === 'failed') this.toast.error('Les heures silencieuses n’ont pas pu être enregistrées.');
  }

  protected hhmm(minutes: number): string {
    return toHhmm(minutes);
  }

  protected addedOn(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
  }

  protected async remove(id: string): Promise<void> {
    if (this.readOnly()) return;
    const ok = await this.push.removeDevice(id);
    if (ok) this.toast.success('Appareil retiré');
    else this.toast.error('Cet appareil n’a pas pu être retiré. Réessaie.');
  }

  protected async sendTest(): Promise<void> {
    if (this.testing() || this.readOnly()) return;
    this.testing.set(true);
    const delivered = await this.push.test();
    this.testing.set(false);
    if (delivered) this.toast.success('Notification envoyée, regarde ton écran');
    else this.toast.error('La notification n’a pas pu être envoyée. Réessaie.');
  }
}
