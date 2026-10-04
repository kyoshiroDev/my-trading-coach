import { Injectable, inject, signal } from '@angular/core';
import { formatMoney } from '@mtc/shared';
import { ToastService } from './toast.service';

/** Événement `prop:alert` du canal `/tradovate-live` (cf. API `PropAlertsService`, #370). */
export interface PropAlertEvent {
  accountId: string;
  accountLabel: string;
  currency: string;
  kind: 'drawdown' | 'daily_loss' | 'consistency' | 'objective' | 'payout';
  /** `reached` : bonne nouvelle (objectif atteint, payout possible). */
  level: 'warning' | 'critical' | 'breached' | 'reached';
  remaining: number;
  limit: number;
  breach: 'account_failed' | 'trading_paused_for_day' | null;
  /** Consistency : part max d'une journée dans le profit (0 à 1). */
  maxShare?: number;
  /** Consistency dépassée : profit supplémentaire pour la respecter de nouveau. */
  extraProfit?: number;
}

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

/** Texte de l'alerte : le compte, ce qui reste, et ce qui se passe si on dépasse. */
export function propAlertMessage(e: PropAlertEvent): string {
  const money = (v: number) => formatMoney(v, e.currency, { decimals: 0, sign: false });
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  switch (e.kind) {
    case 'objective':
      return `${e.accountLabel} : objectif atteint selon l'estimation MyTradingCoach, toutes les règles du plan sont remplies. Vérifie chez ta firm.`;
    case 'payout':
      return `${e.accountLabel} : payout possible selon l'estimation MyTradingCoach. Vérifie les conditions chez ta firm avant de le demander.`;
    case 'consistency': {
      const rule = e.maxShare != null ? ` (une journée ≤ ${pct(e.maxShare)} du profit)` : '';
      if (e.level === 'breached') {
        const extra = e.extraProfit != null ? ` : il faudra environ ${money(e.extraProfit)} de profit en plus pour la respecter` : '';
        return `${e.accountLabel} : ta journée dépasse la règle de consistency${rule}${extra}.`;
      }
      return `${e.accountLabel} : encore ${money(e.remaining)} de gain maximum aujourd'hui pour respecter la consistency${rule}.`;
    }
  }
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
    // Bonne nouvelle (objectif, payout) : reste aussi, c'est une info à ne pas rater.
    if (e.level === 'reached') this.toast.success(message, { duration: null });
    else if (e.level === 'warning') this.toast.warning(message);
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
      const title = e.level === 'reached' ? 'MyTradingCoach · bonne nouvelle' : 'MyTradingCoach · alerte prop firm';
      new Notification(title, { body, tag: `${e.accountId}:${e.kind}` });
    } catch {
      /* contexte sans Notification utilisable (navigateur mobile) : le toast suffit */
    }
  }

  private readPermission(): Permission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as Permission;
  }
}
