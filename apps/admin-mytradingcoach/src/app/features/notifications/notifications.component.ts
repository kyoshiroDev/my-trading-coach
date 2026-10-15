import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ADMIN_PUSH_EVENT_LABELS, AdminPushEvent } from '@mtc/shared';
import { PushService, type PushSupport } from '../../core/push/push.service';

/** Texte affiché pour chaque cas de support (hors `supported`). */
const SUPPORT_MESSAGES: Record<Exclude<PushSupport, 'supported'>, string> = {
  'ios-not-installed':
    "Sur iPhone, les notifications ne marchent que depuis l'admin installée : Partager → Sur l'écran d'accueil, puis ouvre MTC Admin depuis l'icône.",
  unsupported: 'Ce navigateur ne gère pas les notifications push.',
  denied: 'Notifications refusées pour ce site : autorise-les dans les réglages du navigateur, puis recharge la page.',
  'server-disabled': "Les notifications push sont désactivées sur le serveur (PUSH_ENABLED et clés VAPID à configurer).",
};

/** Page « Notifications » : abonnement de CET appareil aux push business et choix des événements. */
@Component({
  selector: 'mtc-admin-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './notifications.component.css',
  templateUrl: './notifications.component.html',
})
export class NotificationsComponent implements OnInit {
  protected readonly push = inject(PushService);

  protected readonly events = (Object.keys(AdminPushEvent) as AdminPushEvent[]).map((key) => ({
    key,
    label: ADMIN_PUSH_EVENT_LABELS[key],
  }));
  protected readonly supportMessage = computed(() => {
    const s = this.push.support();
    return s && s !== 'supported' ? SUPPORT_MESSAGES[s] : null;
  });
  protected readonly testMessage = signal<string | null>(null);
  protected readonly testing = signal(false);

  ngOnInit(): void {
    void this.push.init();
  }

  protected isEnabled(event: AdminPushEvent): boolean {
    return !this.push.mutedEvents().includes(event);
  }

  protected toggleSubscription(): void {
    void (this.push.subscribed() ? this.push.disable() : this.push.enable());
  }

  protected toggleEvent(event: AdminPushEvent, checked: boolean): void {
    void this.push.setEventEnabled(event, checked);
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testMessage.set(null);
    this.testMessage.set(await this.push.test());
    this.testing.set(false);
  }
}
