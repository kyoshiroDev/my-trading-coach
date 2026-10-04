import {
  HEARTBEAT_MS,
  QUOTA_BACKOFF_MS,
  SYNC_REQUEST_ID,
  authorizeMessage,
  backoffDelay,
  cashBalanceUpdate,
  initialAccountState,
  isTradeEvent,
  type BalanceUpdate,
  type InitialAccountState,
  parseFrame,
  shutdownReason,
  syncRequestMessage,
  type TradovateWsMessage,
} from './tradovate-live.protocol';

/** Sous-ensemble du WebSocket natif (Node ≥ 22) utilisé ici : remplaçable en test. */
export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type LiveSocketFactory = (url: string) => LiveSocket;

export const nativeSocketFactory: LiveSocketFactory = (url) =>
  new WebSocket(url) as unknown as LiveSocket;

/** Jeton irrécupérable (reconnexion OAuth requise) : inutile d'insister. */
export class LiveFatalError extends Error {}

const OPEN = 1;

export interface LiveConnectionOptions {
  /**
   * URL du WebSocket, ou fonction relue à CHAQUE (re)connexion, après `getToken` : l'hôte vient de
   * `apiHosts`, qui peut changer pendant la vie de la connexion (bascule d'infra NinjaTrader).
   */
  url: string | (() => string);
  externalAccountId: number;
  /** Jeton d'accès courant (renouvelé si besoin). Lève `LiveFatalError` si la connexion est morte. */
  getToken: () => Promise<string>;
  /** Changement pouvant produire un trade (le service regroupe et synchronise). */
  onTradeEvent: () => void;
  /** Solde réalisé du compte, poussé par Tradovate à chaque variation. */
  onBalance?: (update: BalanceUpdate) => void;
  /** État initial de la souscription (solde, positions ouvertes). */
  onInitialState?: (state: InitialAccountState) => void;
  /** La connexion renonce : l'app retombe sur le bouton « Synchroniser ». */
  onFatal?: (reason: string) => void;
  socketFactory?: LiveSocketFactory;
  logger?: { warn(message: string): void; debug?(message: string): void };
}

/**
 * UNE connexion WebSocket Tradovate pour UN compte synchronisé. Ne crée aucun trade : elle
 * signale seulement qu'il s'est passé quelque chose ; la synchro REST existante fait le reste.
 *
 * - `o` → authorize ; réponse 200 (id 0) → heartbeat `[]` toutes les 2,5 s + `user/syncrequest`.
 * - Fermeture inattendue → reconnexion en backoff exponentiel (1 s → 60 s), 5 min si quota.
 * - `stop()` → timers coupés, socket fermée proprement (1000) : la souscription meurt avec elle.
 */
export class TradovateLiveConnection {
  private socket: LiveSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private authorized = false;
  private quotaReached = false;

  constructor(private readonly opts: LiveConnectionOptions) {}

  get isAuthorized(): boolean {
    return this.authorized;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.authorized = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(1000, 'client closed');
    } catch {
      /* déjà fermée */
    }
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    let token: string;
    try {
      token = await this.opts.getToken();
    } catch (err) {
      if (err instanceof LiveFatalError) {
        this.stopped = true;
        this.opts.onFatal?.(err.message);
        return;
      }
      this.scheduleReconnect(); // verrou occupé, Tradovate indisponible… : on réessaie
      return;
    }
    if (this.stopped) return;

    let socket: LiveSocket;
    try {
      const url = typeof this.opts.url === 'function' ? this.opts.url() : this.opts.url;
      socket = (this.opts.socketFactory ?? nativeSocketFactory)(url);
    } catch (err) {
      this.opts.logger?.warn(`Tradovate WS : ouverture impossible (${(err as Error).message})`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onmessage = (ev) => this.onMessage(String(ev.data), token);
    socket.onclose = () => this.onClosed(socket);
    socket.onerror = () => {
      /* toujours suivi de onclose : la reconnexion part de là */
    };
  }

  private onMessage(raw: string, token: string): void {
    const frame = parseFrame(raw);
    if (frame.kind === 'open') this.send(authorizeMessage(token));
    else if (frame.kind === 'close') this.socket?.close(1000);
    else if (frame.kind === 'data') frame.messages.forEach((m) => this.onData(m));
  }

  private onData(m: TradovateWsMessage): void {
    if (m.i === 0 && typeof m.s === 'number') {
      if (m.s === 200) {
        this.authorized = true;
        this.attempt = 0;
        this.quotaReached = false;
        this.startHeartbeat();
        this.send(syncRequestMessage(SYNC_REQUEST_ID, this.opts.externalAccountId));
      } else {
        // Jeton refusé : on ferme ; la reconnexion redemandera un jeton (renouvelé au besoin).
        this.opts.logger?.warn(`Tradovate WS : autorisation refusée (${m.s})`);
        this.socket?.close(4001);
      }
      return;
    }
    const reason = shutdownReason(m);
    if (reason) {
      if (reason === 'ConnectionQuotaReached') this.quotaReached = true;
      this.opts.logger?.warn(`Tradovate WS : fermeture annoncée (${reason})`);
      return;
    }
    const initial = initialAccountState(m, this.opts.externalAccountId);
    if (initial) {
      this.opts.onInitialState?.(initial);
      return;
    }
    const balance = cashBalanceUpdate(m, this.opts.externalAccountId);
    if (balance) {
      this.opts.onBalance?.(balance);
      return;
    }
    if (isTradeEvent(m, this.opts.externalAccountId)) this.opts.onTradeEvent();
  }

  private onClosed(socket: LiveSocket): void {
    if (this.socket !== socket) return; // ancienne socket (déjà remplacée ou arrêtée)
    this.socket = null;
    this.authorized = false;
    this.clearTimers();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return;
    const delay = this.quotaReached ? QUOTA_BACKOFF_MS : backoffDelay(this.attempt++);
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => this.send('[]'), HEARTBEAT_MS);
  }

  private send(data: string): void {
    const socket = this.socket;
    if (socket && socket.readyState === OPEN) socket.send(data);
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retry) clearTimeout(this.retry);
    this.heartbeat = null;
    this.retry = null;
  }
}
