import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrokerConnection,
  BrokerConnectionStatus,
  BrokerProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { BROKER_TRADE_SOURCES } from '../../trades/trades.service';
import { RedisService } from '../../infra/redis.service';
import { loadTokenKey } from '@api/common/utils/token-cipher.util';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateApiError, TradovateException } from './tradovate.errors';
import { signOAuthState, verifyOAuthState } from './oauth-state.util';
import type { OAuthOrigin } from './oauth-state.util';
import type {
  ExternalAccountRef,
  TradovateAccount,
  TradovateApiHosts,
  TradovateOAuthTokenResponse,
  TradovateUser,
} from './tradovate.types';
import { ACCOUNT_GONE_GRACE_MS, ENVS } from './tradovate-connection.constants';
import {
  availableAccountsOf,
  frontendRedirectUrl,
  toConnectionView,
  type CallbackOutcome,
  type FirstSyncSummary,
  type TradovateConnectionView,
} from './tradovate-connection.view';
import { resolveAccountCurrency } from './tradovate-account-currency';
import { describeHosts, parseApiHosts } from './tradovate-hosts';
import { TradovateLocks } from './tradovate-locks';
import { TradovateTokenManager, buildTokenColumns } from './tradovate-token-manager';
import type { TradovateSession } from './tradovate-token-manager';

// Réexports : les appelants existants importent ces noms depuis le service.
export { ACCOUNT_GONE_GRACE_MS, REFUSAL_COOLDOWN_S } from './tradovate-connection.constants';
export type { CallbackOutcome, FirstSyncSummary, TradovateConnectionView } from './tradovate-connection.view';

/**
 * Cycle de vie d'une connexion Tradovate PAR TradingAccount : consentement OAuth,
 * échange du code côté serveur, stockage chiffré des tokens, renouvellement sans nouveau
 * consentement, choix du compte broker, déconnexion.
 *
 * MTC ne voit jamais le mot de passe Tradovate : l'utilisateur s'authentifie chez Tradovate,
 * MTC ne reçoit qu'un code puis des tokens révocables, en lecture seule.
 */
@Injectable()
export class TradovateConnectionService {
  private readonly logger = new Logger(TradovateConnectionService.name);
  private readonly locks: TradovateLocks;
  private readonly tokens: TradovateTokenManager;

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TradovateApiClient,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    // `this.redis` (et non `redis`) : les tests lisent les appels Redis sur ce même client.
    this.locks = new TradovateLocks(this.redis, this.logger);
    this.tokens = new TradovateTokenManager({
      prisma,
      api,
      locks: this.locks,
      logger: this.logger,
      tokenKey: () => this.tokenKey(),
      wait: (ms) => this.wait(ms),
      markNeedsReconnect: (id, cause) => this.markNeedsReconnect(id, cause),
    });
  }

  // ── Consentement ──────────────────────────────────────────────────────────

  /** URL de consentement pour CE compte, + le `state` à poser aussi en cookie. */
  async startAuthorization(
    userId: string,
    accountId: string,
    origin: OAuthOrigin = 'settings',
  ): Promise<{ url: string; state: string }> {
    this.assertConfigured();
    await this.assertAccountOwned(userId, accountId);
    const state = signOAuthState({ userId, accountId, origin }, this.stateSecret());
    return { url: this.api.buildAuthorizeUrl(state), state };
  }

  /**
   * Retour de Tradovate. Ne lève jamais : renvoie toujours un résultat, converti en URL de
   * l'app par `frontendRedirect`. L'utilisateur ne voit jamais une page d'erreur de l'API.
   *
   * `cookieState` (posé par l'API au démarrage, httpOnly) est OBLIGATOIRE : il prouve que ce
   * navigateur a lui-même lancé la connexion. Sans lui, un tiers pourrait envoyer son propre
   * lien de consentement à une victime et recevoir les trades Tradovate de celle-ci dans son
   * compte MTC. Si Tradovate renvoie aussi `state`, les deux doivent être identiques.
   */
  async completeAuthorization(
    query: { code?: string; state?: string; error?: string },
    cookieState?: string,
  ): Promise<CallbackOutcome> {
    const payload = verifyOAuthState(cookieState, this.stateSecret());
    // Sans state lisible, on ne sait pas d'où il vient : les réglages, jamais une page morte.
    if (!payload) return { status: 'error', reason: 'session_expired', origin: 'settings' };
    const { userId, accountId, origin } = payload;
    if (query.state && query.state !== cookieState) {
      return { status: 'error', reason: 'state_mismatch', accountId, origin };
    }
    if (query.error) return { status: 'error', reason: 'denied', accountId, origin };
    if (!query.code) return { status: 'error', reason: 'missing_code', accountId, origin };

    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!account) return { status: 'error', reason: 'account_not_found', origin };

    try {
      this.assertConfigured();
      const { tokens, apiHosts } = await this.exchangeWithHosts(query.code);
      const available = await this.discoverAccounts(tokens.access_token as string, apiHosts);
      // Garde-fou : on ne propose JAMAIS un compte déjà relié par un autre utilisateur MTC.
      // Filtré avant le choix, donc ni choisi automatiquement, ni offert à l'écran de sélection.
      const libres = await this.dropAlreadyLinked(userId, available);
      if (available.length === 0) return { status: 'error', reason: 'no_account', accountId, origin };
      if (libres.length === 0) {
        return { status: 'error', reason: 'account_already_linked', accountId, origin };
      }
      const login = await this.discoverLogin(tokens.access_token as string, libres, apiHosts);
      const conn = await this.saveConnection(userId, accountId, tokens, libres, login, apiHosts);
      return conn.externalAccountId
        ? { status: 'connected', accountId, userId, origin }
        : { status: 'select_account', accountId, userId, origin };
    } catch (err) {
      const reason =
        err instanceof TradovateApiError && err.kind === 'rate_limited'
          ? 'rate_limited'
          : err instanceof TradovateException && err.code === 'TRADOVATE_NOT_CONFIGURED'
            ? 'not_configured'
            : 'exchange_failed';
      this.logger.warn(`Callback Tradovate en échec (user=${userId}) : ${(err as Error).message}`);
      return { status: 'error', reason, accountId, origin };
    }
  }

  /**
   * Échange du code + hôtes du login. `/auth/oauthtoken` ne renvoie pas `apiHosts` : on les lit
   * par un `renewAccessToken` immédiat, AVANT de lister les comptes — l'hôte demo d'une prop firm
   * est propre à son organisation, et l'hôte historique ne répond plus depuis le 2026-10-03.
   * Jamais bloquant : sans hôtes, on retombe sur les hôtes historiques.
   */
  private async exchangeWithHosts(
    code: string,
  ): Promise<{ tokens: TradovateOAuthTokenResponse; apiHosts: TradovateApiHosts | null }> {
    const tokens = await this.api.exchangeCode(code);
    const direct = parseApiHosts(tokens.apiHosts);
    if (direct) {
      this.logger.log(`apiHosts Tradovate (oauthtoken) : ${describeHosts(direct)}.`);
      return { tokens, apiHosts: direct };
    }
    try {
      const renewed = await this.api.renewAccessToken(tokens.access_token as string);
      this.logger.log(`apiHosts Tradovate (renewAccessToken) : ${describeHosts(renewed.apiHosts)}.`);
      const expiresIn = Math.max(0, Math.round((new Date(renewed.expirationTime).getTime() - Date.now()) / 1000));
      return {
        tokens: { ...tokens, access_token: renewed.accessToken, expires_in: expiresIn || tokens.expires_in },
        apiHosts: renewed.apiHosts,
      };
    } catch (err) {
      this.logger.warn(`apiHosts Tradovate non lus à la connexion (${(err as Error).message}) : hôtes historiques.`);
      return { tokens, apiHosts: null };
    }
  }

  /** Comptes accessibles avec ce token, sur les deux hôtes (réels + simulés). */
  private async discoverAccounts(
    accessToken: string,
    apiHosts?: TradovateApiHosts | null,
  ): Promise<ExternalAccountRef[]> {
    const found: ExternalAccountRef[] = [];
    let lastError: unknown = null;
    for (const env of ENVS) {
      try {
        const list = await this.api.get<TradovateAccount[]>(env, '/account/list', accessToken, undefined, apiHosts);
        for (const a of Array.isArray(list) ? list : []) {
          if (a.closed) continue; // compte fermé : plus rien à synchroniser
          found.push({ id: String(a.id), name: a.name, env, userId: a.userId != null ? String(a.userId) : undefined });
        }
      } catch (err) {
        // Un hôte peut refuser le token (ex. aucun compte simulé) : l'autre suffit.
        lastError = err;
        this.logger.warn(`account/list ${env} indisponible : ${(err as Error).message}`);
      }
    }
    if (found.length === 0 && lastError) throw lastError;
    return found;
  }

  /**
   * Écarte les comptes déjà reliés par un AUTRE utilisateur MTC.
   *
   * Deux connexions sur le même compte broker se volent leur jeton : Tradovate invalide la copie de
   * l'autre à chaque renouvellement, et `propagateToSiblings` est scopé au `userId` MTC — il ne peut
   * donc rien y faire. Résultat vu en vrai le 2026-09-27 : un compte relié par deux comptes MTC,
   * l'un vivant, l'autre définitivement « à reconnecter ».
   *
   * Volontairement sans filtre de statut : une connexion « à reconnecter » garde son refresh_token
   * et le cron peut la ressusciter, donc elle reste un voleur en sommeil. Le prix de ce choix est
   * qu'un compte abandonné par un autre utilisateur doit être délié chez lui — c'est ce que dit le
   * message d'erreur.
   */
  private async dropAlreadyLinked(
    userId: string,
    accounts: ExternalAccountRef[],
  ): Promise<ExternalAccountRef[]> {
    if (accounts.length === 0) return accounts;
    const pris = await this.prisma.brokerConnection.findMany({
      where: {
        provider: BrokerProvider.TRADOVATE,
        userId: { not: userId },
        externalAccountId: { in: accounts.map((a) => a.id) },
      },
      select: { externalAccountId: true },
    });
    if (pris.length === 0) return accounts;
    const interdits = new Set(pris.map((p) => p.externalAccountId));
    this.logger.warn(
      `Comptes Tradovate écartés (déjà reliés par un autre utilisateur) : ${[...interdits].join(', ')}.`,
    );
    return accounts.filter((a) => !interdits.has(a.id));
  }

  /**
   * Le login = l'utilisateur Tradovate authentifié par ce jeton (`/user/list`, un seul élément).
   *
   * Surtout pas `account.userId` : sur un compte prop firm c'est l'identifiant de la FIRME, donc
   * le même pour tous ses traders. Mesuré le 2026-09-27 : deux traders Apex étrangers l'un à
   * l'autre portaient `699523`, ce qui faisait partager à toute la plateforme Apex un unique
   * verrou de renouvellement `tradovate:login:699523`.
   *
   * Jamais bloquant : sans login on retombe sur un verrou par connexion et aucune propagation,
   * ce qui dégrade mais ne casse rien. Une connexion ne doit pas échouer pour ça.
   */
  private async discoverLogin(
    accessToken: string,
    available: ExternalAccountRef[],
    apiHosts?: TradovateApiHosts | null,
  ): Promise<string | null> {
    // Les hôtes où ce jeton a effectivement répondu, sinon les deux.
    const envs = available.length ? [...new Set(available.map((a) => a.env))] : [...ENVS];
    for (const env of envs) {
      try {
        const users = await this.api.get<TradovateUser[]>(env, '/user/list', accessToken, undefined, apiHosts);
        const id = (Array.isArray(users) ? users : [])[0]?.id;
        if (id != null) return String(id);
      } catch (err) {
        this.logger.warn(`user/list ${env} indisponible : ${(err as Error).message}`);
      }
    }
    return null;
  }

  private async saveConnection(
    userId: string,
    accountId: string,
    tokens: TradovateOAuthTokenResponse,
    available: ExternalAccountRef[],
    login: string | null,
    apiHosts: TradovateApiHosts | null,
  ): Promise<BrokerConnection> {
    const where = { accountId_provider: { accountId, provider: BrokerProvider.TRADOVATE } };
    const previous = await this.prisma.brokerConnection.findUnique({ where });
    // Reconnexion : on garde le compte choisi s'il est toujours accessible. Sinon, choix
    // automatique quand il n'y a qu'un compte, choix explicite (front) quand il y en a plusieurs.
    const kept = previous?.externalAccountId
      ? available.find((a) => a.id === previous.externalAccountId && a.env === previous.externalEnv)
      : undefined;
    const chosen = kept ?? (available.length === 1 ? available[0] : undefined);

    const data = {
      status: BrokerConnectionStatus.CONNECTED,
      ...buildTokenColumns(tokens, this.tokenKey()),
      externalAccountId: chosen?.id ?? null,
      externalAccountName: chosen?.name ?? null,
      externalEnv: chosen?.env ?? null,
      // Le login : l'utilisateur AUTHENTIFIÉ, pas le propriétaire du compte (cf. discoverLogin).
      // Il sert à sérialiser les renouvellements et à propager le jeton aux connexions sœurs.
      externalUserId: login,
      availableAccounts: available as unknown as Prisma.InputJsonValue,
      // Sans hôtes lus, `apiHostsAt` null : le prochain jeton demandé les relira.
      apiHosts: apiHosts ? (apiHosts as Prisma.InputJsonValue) : Prisma.DbNull,
      apiHostsAt: apiHosts ? new Date() : null,
      lastSyncError: null,
    };
    const saved = await this.prisma.brokerConnection.upsert({
      where,
      create: { userId, accountId, provider: BrokerProvider.TRADOVATE, ...data },
      update: data,
    });
    // Compte choisi automatiquement (un seul compte, ou reconnexion) : il ne passe jamais par
    // selectAccount, sa devise doit donc être alignée ici — sinon elle resterait celle saisie à la
    // main à la création du compte MTC, souvent EUR pour un compte broker en USD.
    if (chosen) {
      await this.syncAccountCurrency(accountId, saved, chosen, {
        token: tokens.access_token as string,
        apiHosts,
      });
    }
    return saved;
  }

  // ── Gestion ───────────────────────────────────────────────────────────────

  async list(userId: string): Promise<TradovateConnectionView[]> {
    const rows = await this.prisma.brokerConnection.findMany({
      where: { userId, provider: BrokerProvider.TRADOVATE },
      orderBy: { createdAt: 'asc' },
    });
    const counts = await this.brokerTradesCounts(userId, rows.map((r) => r.accountId));
    return rows.map((r) => this.toView(r, counts.get(r.accountId) ?? 0));
  }

  /** Choix du compte Tradovate à synchroniser vers ce TradingAccount. */
  async selectAccount(
    userId: string,
    accountId: string,
    externalAccountId: string,
  ): Promise<TradovateConnectionView> {
    const conn = await this.getConnection(userId, accountId);
    const target = availableAccountsOf(conn).find((a) => a.id === externalAccountId);
    if (!target) throw new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');
    // Même garde-fou qu'au consentement, mais avec un message explicite : ici l'utilisateur a
    // désigné CE compte, il doit savoir pourquoi on le refuse plutôt que de le voir disparaître.
    if ((await this.dropAlreadyLinked(userId, [target])).length === 0) {
      throw new TradovateException('TRADOVATE_ACCOUNT_ALREADY_LINKED');
    }
    const updated = await this.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: {
        externalAccountId: target.id,
        externalAccountName: target.name,
        externalEnv: target.env,
        // `externalUserId` n'est PAS retouché ici : changer de compte ne change pas l'utilisateur
        // authentifié, et `target.userId` est le propriétaire du compte (la firme sur un compte
        // prop firm), donc l'écrire ici écraserait le bon login par un identifiant partagé.
        // Efface la raison d'un rechoix (« ce compte n'existe plus… ») : le nouveau compte est posé.
        lastSyncError: null,
      },
    });
    // La devise du compte suit le broker, lue chez lui (cf. resolveAccountCurrency).
    await this.syncAccountCurrency(accountId, conn, target);
    const counts = await this.brokerTradesCounts(userId, [accountId]);
    return this.toView(updated, counts.get(accountId) ?? 0);
  }

  /**
   * Aligne la devise du TradingAccount sur celle du compte broker. Best-effort et JAMAIS bloquant :
   * un token expiré ou un `/cashBalance` indisponible ne doit pas faire échouer le choix du compte,
   * la devise reste alors celle déjà posée et sera corrigée à la prochaine sélection.
   */
  private async syncAccountCurrency(
    accountId: string,
    conn: BrokerConnection,
    target: ExternalAccountRef,
    known?: TradovateSession,
  ): Promise<void> {
    const session = known ?? (await this.getSession(conn).catch(() => null));
    if (!session) {
      this.logger.warn(`Devise du compte ${target.id} non relue : aucun token exploitable.`);
      return;
    }
    const currency = await resolveAccountCurrency(this.api, this.logger, target, session.token, session.apiHosts);
    await this.prisma.tradingAccount.update({ where: { id: accountId }, data: { currency } });
  }

  /**
   * Déconnexion : les tokens sont SUPPRIMÉS de la base (pas seulement désactivés). La Trade API
   * n'expose pas d'endpoint de révocation documenté ; sans token stocké, MTC ne peut plus rien
   * lire. Les trades déjà importés restent (ce sont ceux de l'utilisateur) ; leur suppression
   * optionnelle est orchestrée par `TradovateSyncService.disconnect`.
   */
  async disconnect(userId: string, accountId: string): Promise<{ disconnected: true }> {
    const { count } = await this.prisma.brokerConnection.deleteMany({
      where: { userId, accountId, provider: BrokerProvider.TRADOVATE },
    });
    if (count === 0) throw new TradovateException('TRADOVATE_NOT_CONNECTED');
    return { disconnected: true };
  }

  async getConnection(userId: string, accountId: string): Promise<BrokerConnection> {
    const conn = await this.prisma.brokerConnection.findFirst({
      where: { userId, accountId, provider: BrokerProvider.TRADOVATE },
    });
    if (!conn) throw new TradovateException('TRADOVATE_NOT_CONNECTED');
    return conn;
  }

  // ── Tokens (logique dans TradovateTokenManager) ─────────────────────────

  /**
   * Access token valide pour cette connexion, renouvelé si besoin SANS repasser par l'écran
   * de consentement. Si tout échoue → connexion marquée NEEDS_RECONNECT et erreur claire.
   */
  getAccessToken(conn: BrokerConnection): Promise<string> {
    return this.tokens.getAccessToken(conn);
  }

  /** Jeton + `apiHosts` frais de la connexion (cf. TradovateTokenManager.getSession). */
  getSession(conn: BrokerConnection): Promise<TradovateSession> {
    return this.tokens.getSession(conn);
  }

  /** Renouvellement immédiat (cron de maintien) : 'refreshed' | 'reconnect' | 'retry'. */
  refreshNow(conn: BrokerConnection): Promise<'refreshed' | 'reconnect' | 'retry'> {
    return this.tokens.refreshNow(conn);
  }

  /** Seconde chance d'une connexion « à reconnecter » dont le refresh_token est encore promis. */
  tryRevive(conn: BrokerConnection): Promise<boolean> {
    return this.tokens.tryRevive(conn);
  }

  /** Rattache le login Tradovate (`externalUserId`) aux connexions qui ne l'ont pas encore. */
  rememberLogin(conn: BrokerConnection, externalUserId: number | undefined, accountIdsOfLogin: string[] = []): Promise<number> {
    return this.tokens.rememberLogin(conn, externalUserId, accountIdsOfLogin);
  }

  /** Point d'attente isolé : les tests le remplacent pour ne pas dormir 2 s. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Le compte choisi n'apparaît plus dans `/account/list` de son hôte. Trois issues, jamais une
   * reconnexion (le token, lui, fonctionne) :
   * - il est sur l'AUTRE hôte → on corrige `externalEnv` et la synchro continue ;
   * - absent depuis moins de `ACCOUNT_GONE_GRACE_MS` → trou passager, on réessaiera ;
   * - absent durablement (clôturé ou remplacé par la prop firm) → la connexion est détachée du
   *   compte, la liste des comptes du login est relue : l'utilisateur choisit le suivant, sans
   *   refaire le consentement.
   */
  async handleMissingAccount(
    conn: BrokerConnection,
    accessToken: string,
    apiHosts?: TradovateApiHosts | null,
  ): Promise<BrokerConnection> {
    const available = await this.discoverAccounts(accessToken, apiHosts);
    const moved = available.find((a) => a.id === conn.externalAccountId);
    if (moved) {
      this.logger.warn(
        `Compte Tradovate ${conn.externalAccountId} passé de ${conn.externalEnv} à ${moved.env} (connexion ${conn.id}).`,
      );
      return this.prisma.brokerConnection.update({
        where: { id: conn.id },
        data: { externalEnv: moved.env, availableAccounts: available as unknown as Prisma.InputJsonValue },
      });
    }

    const lastOk = conn.lastSyncAt?.getTime() ?? 0;
    if (Date.now() - lastOk < ACCOUNT_GONE_GRACE_MS) {
      this.logger.warn(
        `Compte Tradovate ${conn.externalAccountId} absent de la liste du login (connexion ${conn.id}) : ` +
          `on patiente (${available.map((a) => `${a.id}@${a.env}`).join(', ') || 'liste vide'}).`,
      );
      throw new TradovateException('TRADOVATE_ACCOUNT_TEMPORARILY_MISSING');
    }

    this.logger.warn(
      `Compte Tradovate ${conn.externalAccountName} (${conn.externalAccountId}) disparu du login depuis plus de ` +
        `${ACCOUNT_GONE_GRACE_MS / 3_600_000} h (connexion ${conn.id}) : détaché, choix du compte redemandé ` +
        `parmi ${available.map((a) => a.name).join(', ') || 'aucun'}.`,
    );
    await this.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: {
        externalAccountId: null,
        externalAccountName: null,
        externalEnv: null,
        availableAccounts: available as unknown as Prisma.InputJsonValue,
      },
    });
    throw new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');
  }

  /** Verrou de la connexion, partagé par la synchro et le cron (cf. LOCK_TTL_S). */
  tryLock(connectionId: string): Promise<boolean> {
    return this.locks.tryLock(connectionId);
  }

  unlock(connectionId: string): Promise<void> {
    return this.locks.unlock(connectionId);
  }

  /** `cause` est journalisée : chaque condamnation doit pouvoir s'expliquer après coup. */
  async markNeedsReconnect(connectionId: string, cause: string): Promise<void> {
    this.logger.warn(`Connexion Tradovate ${connectionId} → À RECONNECTER (${cause}).`);
    await this.prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        status: BrokerConnectionStatus.NEEDS_RECONNECT,
        lastSyncError: 'Connexion expirée ou révoquée : reconnecte ton compte Tradovate.',
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  assertConfigured(): void {
    if (!this.api.isConfigured() || !this.config.get<string>('BROKER_TOKEN_ENCRYPTION_KEY')) {
      throw new TradovateException('TRADOVATE_NOT_CONFIGURED');
    }
  }

  private async assertAccountOwned(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Compte introuvable.');
  }

  private toView(conn: BrokerConnection, brokerTradesCount = 0): TradovateConnectionView {
    return toConnectionView(conn, brokerTradesCount);
  }

  /** Trades importés par le broker, par compte : affichés AVANT de proposer leur suppression. */
  private async brokerTradesCounts(userId: string, accountIds: string[]): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();
    const groups = await this.prisma.trade.groupBy({
      by: ['accountId'],
      where: { userId, accountId: { in: accountIds }, source: { in: BROKER_TRADE_SOURCES } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.accountId as string, g._count._all] as const));
  }

  /** URL de retour dans l'app après le consentement (cf. frontendRedirectUrl). */
  frontendRedirect(outcome: CallbackOutcome, sync?: FirstSyncSummary): string {
    return frontendRedirectUrl(this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app', outcome, sync);
  }

  private tokenKey(): Buffer {
    return loadTokenKey(this.config.get<string>('BROKER_TOKEN_ENCRYPTION_KEY'));
  }

  private stateSecret(): string {
    return this.config.get<string>('JWT_SECRET') ?? process.env['JWT_SECRET'] ?? '';
  }
}
