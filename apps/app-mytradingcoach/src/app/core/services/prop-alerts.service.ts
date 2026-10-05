import { Injectable, inject, signal } from '@angular/core';
import { formatMoney } from '@mtc/shared';
import { ToastService } from './toast.service';
import { AlertSoundService } from './alert-sound.service';

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

/** Événement `tilt:alert` : signal de tilt sur le dernier trade synchronisé (PREMIUM, #371). */
export interface TiltAlertEvent {
  accountId: string;
  accountLabel: string;
  signal: 'revenge' | 'size' | 'overtrading';
  ref: string;
  minutes?: number;
  quantity?: number;
  medianQuantity?: number;
  count?: number;
  medianCount?: number;
  /** Humeur notée en pré-session (session ouverte), sinon null. */
  moodStart: 'CONFIDENT' | 'FOCUSED' | 'NEUTRAL' | 'TIRED' | 'STRESSED' | null;
}

/** Un nudge reste assez longtemps pour être lu entre deux trades, sans bloquer. */
export const TILT_TOAST_MS = 15_000;

const MOOD_LABEL: Partial<Record<NonNullable<TiltAlertEvent['moodStart']>, string>> = {
  TIRED: 'fatigué',
  STRESSED: 'stressé',
};

/** Nudge anti-tilt : le fait, l'humeur du jour si elle pèse, puis une question (jamais un ordre). */
export function tiltMessage(e: TiltAlertEvent): string {
  const mood = e.moodStart && MOOD_LABEL[e.moodStart] ? ` Tu avais noté « ${MOOD_LABEL[e.moodStart]} » en pré-session.` : '';
  switch (e.signal) {
    case 'revenge': {
      const m = Math.max(1, Math.round(e.minutes ?? 0));
      return `${e.accountLabel} : trade repris ${m} min après une perte.${mood} Une pause de 10 minutes ?`;
    }
    case 'size':
      return `${e.accountLabel} : ${e.quantity} contrats juste après une perte, plus du double de ta taille habituelle (${e.medianQuantity}).${mood} Une pause avant le prochain ?`;
    case 'overtrading':
      return `${e.accountLabel} : ${e.count} trades aujourd'hui, plus du double d'une journée habituelle (${e.medianCount}).${mood} Tu suis toujours ton plan ?`;
  }
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
  private readonly sound = inject(AlertSoundService);

  readonly permission = signal<Permission>(this.readPermission());

  handle(e: PropAlertEvent): void {
    const message = propAlertMessage(e);
    // Avertissement : le temps de le lire. Critique ou dépassé : reste jusqu'à fermeture.
    // Bonne nouvelle (objectif, payout) : reste aussi, c'est une info à ne pas rater.
    if (e.level === 'reached') this.toast.success(message, { duration: null });
    else if (e.level === 'warning') this.toast.warning(message);
    else this.toast.error(message, { duration: null });
    this.sound.play(e.level === 'reached' ? 'reached' : e.level === 'warning' ? 'warning' : 'critical');
    this.notify(e, message);
  }

  /** Nudge anti-tilt : avertissement non bloquant + notification « pause ? ». */
  handleTilt(e: TiltAlertEvent): void {
    const message = tiltMessage(e);
    this.toast.warning(message, { duration: TILT_TOAST_MS });
    this.sound.play('tilt');
    this.show('MyTradingCoach · pause ?', message, `${e.accountId}:tilt:${e.signal}`);
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
    const title = e.level === 'reached' ? 'MyTradingCoach · bonne nouvelle' : 'MyTradingCoach · alerte prop firm';
    this.show(title, body, `${e.accountId}:${e.kind}`);
  }

  /** `tag` : une nouvelle alerte du même compte et du même type remplace la précédente. */
  private show(title: string, body: string, tag: string): void {
    if (this.readPermission() !== 'granted') return;
    try {
      new Notification(title, { body, tag });
    } catch {
      /* contexte sans Notification utilisable (navigateur mobile) : le toast suffit */
    }
  }

  private readPermission(): Permission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as Permission;
  }
}
