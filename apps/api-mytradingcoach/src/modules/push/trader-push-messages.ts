import type { TraderPushPayload } from '@mtc/shared';
import { REVENGE_MIN_MINUTES } from '@api/common/utils/execution-grade.util';
import type { PropAlertEvent } from '../integrations/tradovate/prop-alerts.service';
import type { TiltAlertEvent } from '../integrations/tradovate/tilt-alerts.service';
import type { BehaviorAlertDraft } from '../behavior/behavior-detectors';

/**
 * Contenu d'un push vers un trader (#666). Une phrase FACTUELLE : aucun conseil d'achat ou de
 * vente, aucune promesse, et **aucun montant** (l'écran verrouillé est visible par d'autres) :
 * libellé du compte, seuils en pourcentage ou en nombre de trades. Toute règle de firm porte la
 * mention « estimation MyTradingCoach ».
 */
export interface TraderPushMessage {
  title: string;
  body: string;
  /** Chemin de l'app ouvert au clic. */
  url: string;
  /** La dernière notification d'un même tag remplace la précédente. */
  tag: string;
  urgency: 'high' | 'normal';
  /** Au-delà, le service push abandonne : une alerte de séance périmée n'a plus d'intérêt. */
  ttlSeconds: number;
}

const ESTIMATION = '(estimation MyTradingCoach)';
/** Alerte relevée par la synchro de fond (app fermée, cron 15 min) : le décalage est dit. */
export const BACKGROUND_NOTE = 'Relevé de la synchro automatique, jusqu’à 15 min de décalage.';
const SESSION_URL = '/session';
export const PUSH_SETTINGS_URL = '/profil#notifications';
const HOUR = 3600;

/** Alerte de séance : ouvre la Session live, vit une heure. */
const live = (title: string, body: string, tag: string, urgency: 'high' | 'normal'): TraderPushMessage => ({
  title, body, url: SESSION_URL, tag, urgency, ttlSeconds: HOUR,
});

/**
 * Alerte prop firm relayée en push, ou `null` si elle reste dans l'app seulement : le premier
 * seuil (25 %) et l'approche de la consistency sonneraient trop tôt.
 */
function propAlert(e: PropAlertEvent, opts: { background?: boolean } = {}): TraderPushMessage | null {
  const tag = `prop-${e.accountId}-${e.kind}`;
  const urgent = e.level === 'critical' || e.level === 'breached';
  const body = (() => {
    switch (e.kind) {
      case 'drawdown':
        if (e.level === 'critical') return `Il reste moins de 10 % de ta marge de drawdown ${ESTIMATION}.`;
        if (e.level === 'breached') return `Drawdown max dépassé, d'après tes trades synchronisés ${ESTIMATION}.`;
        return null;
      case 'daily_loss':
        if (e.level === 'critical') return `Il reste moins de 10 % de ta perte max du jour ${ESTIMATION}.`;
        if (e.level === 'breached') return `Limite de perte du jour atteinte, d'après tes trades synchronisés ${ESTIMATION}.`;
        return null;
      case 'consistency':
        if (e.level === 'breached') return `Ta journée dépasse la part maximale fixée par la règle de consistency ${ESTIMATION}.`;
        return null;
      case 'objective':
        return e.level === 'reached' ? `Objectif atteint ${ESTIMATION}.` : null;
      case 'payout':
        return e.level === 'reached' ? `Payout possible selon les règles du plan ${ESTIMATION}.` : null;
    }
  })();
  if (!body) return null;
  return live(e.accountLabel, opts.background ? `${body} ${BACKGROUND_NOTE}` : body, tag, urgent ? 'high' : 'normal');
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** Une médiane peut tomber entre deux valeurs : une décimale au plus, virgule française. */
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

/** Anti-tilt (#371) : le constat chiffré du détecteur, rien de plus. */
function tilt(e: TiltAlertEvent): TraderPushMessage {
  const tag = `tilt-${e.accountId}-${e.signal}`;
  switch (e.signal) {
    case 'revenge':
      return live(e.accountLabel, `Nouveau trade moins de ${REVENGE_MIN_MINUTES} min après une perte.`, tag, 'normal');
    case 'size':
      return live(
        e.accountLabel,
        e.quantity != null && e.medianQuantity != null
          ? `Taille de ${num(e.quantity)} juste après une perte, ta médiane est de ${num(e.medianQuantity)}.`
          : 'Taille au-dessus de ta médiane juste après une perte.',
        tag,
        'normal',
      );
    case 'overtrading':
      return live(
        e.accountLabel,
        e.count != null && e.medianCount != null
          ? `${plural(e.count, 'trade')} aujourd'hui, ta médiane est de ${num(e.medianCount)} par jour.`
          : "Journée plus chargée que d'habitude.",
        tag,
        'normal',
      );
  }
}

/**
 * Détecteurs de comportement (#602) : leur message est déjà une phrase factuelle sans montant. Les
 * détecteurs A (`A1_…`, `A2_…`, `A3_…`) citent une règle du plan de la firm : mention d'estimation.
 */
function behavior(accountId: string, draft: Pick<BehaviorAlertDraft, 'type' | 'message'>): TraderPushMessage {
  const body = draft.type.startsWith('A') ? `${draft.message.replace(/\.$/, '')} ${ESTIMATION}.` : draft.message;
  return live('Signal de comportement', body, `behavior-${accountId}-${draft.type}`, 'normal');
}

export const TRADER_PUSH_MESSAGES = {
  propAlert,
  tilt,
  behavior,
  recapReady: (): TraderPushMessage => ({
    title: 'Récap du jour',
    body: 'Ton récap du jour est prêt.',
    url: '/dashboard',
    tag: 'recap',
    urgency: 'normal',
    ttlSeconds: 12 * HOUR,
  }),
  tradovateReconnect: (accountId: string, accountLabel: string): TraderPushMessage => ({
    title: 'Connexion Tradovate à renouveler',
    body: `« ${accountLabel} » ne se synchronise plus. Reconnecte-le depuis Comptes.`,
    url: '/accounts',
    tag: `connection-${accountId}`,
    urgency: 'normal',
    ttlSeconds: 24 * HOUR,
  }),
  test: (): TraderPushMessage => ({
    title: 'Notification de test',
    body: 'Les notifications de MyTradingCoach fonctionnent sur cet appareil.',
    url: PUSH_SETTINGS_URL,
    tag: 'test',
    urgency: 'normal',
    ttlSeconds: HOUR,
  }),
};

/** Ce que reçoit le service worker de l'app (`TraderPushPayload`). */
export function traderPushPayload(message: TraderPushMessage, nowMs: number): TraderPushPayload {
  return {
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
    timestamp: nowMs,
    settingsUrl: PUSH_SETTINGS_URL,
  };
}
