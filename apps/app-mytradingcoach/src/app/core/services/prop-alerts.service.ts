import { Injectable, inject, signal } from '@angular/core';
import { formatMoney } from '@mtc/shared';
import { ToastService } from './toast.service';

/** Événement `prop:alert` du canal `/tradovate-live` (cf. API `PropAlertsService`, #370). */
export interface PropAlertEvent {
  accountId: string;
  accountLabel: string;
  currency: string;
  kind: 'drawdown' | 'daily_loss';
  level: 'warning' | 'critical' | 'breached';
  remaining: number;
  limit: number;
  breach: 'account_failed' | 'trading_paused_for_day' | null;
}

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

/** Texte de l'alerte : le compte, ce qui reste, et ce qui se passe si on dépasse. */
export function propAlertMessage(e: PropAlertEvent): string {
  const money = (v: number) => formatMoney(v, e.currency, { decimals: 0, sign: false });
  if (e.kind === 'drawdown') {
    return e.level === 'breached'
      ? `${e.accountLabel} : plancher de drawdown atteint selon l'estimation MyTradingCoach. Vérifie ton compte chez ta firm.`
      : `${e.accountLabel} : plus que ${money(e.remaining)} avant le plancher de drawdown.`;
  }
  if (e.level === 'breached') {
    const effect = e.breach === 'account_failed'
      ? "chez ta firm, c'est un échec du compte"
      : 'ta firm coupe le trading jusqu’à la prochaine séance';
    return `${e.accountLabel} : limite de perte journalière atteinte (${money(e.limit)}) : ${effect}.`;
  }
  return `${e.accountLabel} : plus que ${money(e.remaining)} de perte permise aujourd'hui (limite ${money(e.limit)}).`;
}

/**
 * Alertes prop firm « avant la casse » (PREMIUM, #370), poussées par l'API pendant que l'app est
 * ouverte : toast dans l'app, et notification système du navigateur si l'utilisateur l'a
 * autorisée (il regarde sa plateforme, pas l'onglet MTC). Le serveur décide quand alerter.
 */
@Injectable({ providedIn: 'root' })
export class PropAlertsService {
  private readonly toast = inject(ToastService);

  readonly permission = signal<Permission>(this.readPermission());

  handle(e: PropAlertEvent): void {
    const message = propAlertMessage(e);
    // Avertissement : le temps de le lire. Critique ou dépassé : reste jusqu'à fermeture.
    if (e.level === 'warning') this.toast.warning(message);
    else this.toast.error(message, { duration: null });
    this.notify(e, message);
  }

  /** Demande l'autorisation des notifications système (sur un clic de l'utilisateur). */
  async requestPermission(): Promise<void> {
    if (this.permission() === 'unsupported') return;
    try {
      this.permission.set((await Notification.requestPermission()) as Permission);
    } catch {
      this.permission.set(this.readPermission());
    }
  }

  private notify(e: PropAlertEvent, body: string): void {
    if (this.readPermission() !== 'granted') return;
    try {
      // `tag` : une nouvelle alerte du même compte et du même type remplace la précédente.
      new Notification('MyTradingCoach · alerte prop firm', { body, tag: `${e.accountId}:${e.kind}` });
    } catch {
      /* contexte sans Notification utilisable (navigateur mobile) : le toast suffit */
    }
  }

  private readPermission(): Permission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as Permission;
  }
}
