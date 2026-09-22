import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrokerConnection,
  BrokerConnectionStatus,
  BrokerProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../shared/redis.service';
import { decryptToken, encryptToken, loadTokenKey } from '../../../common/utils/token-cipher.util';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateApiError, TradovateException } from './tradovate.errors';
import { OAuthOrigin, signOAuthState, verifyOAuthState } from './oauth-state.util';
import { DEFAULT_ACCOUNT_CURRENCY, isAccountCurrency, normalizeCurrencyCode } from '@mtc/shared';
import type { AccountCurrency } from '@mtc/shared';
import type {
  ExternalAccountRef,
  TradovateAccount,
  TradovateCashBalance,
  TradovateCurrency,
  TradovateEnv,
  TradovateOAuthTokenResponse,
} from './tradovate.types';

/**
 * Marge avant expiration : on renouvelle l'access token (≈ 80 min) bien AVANT sa fin.
 *
 * 40 min et non 5 (bug prod du 2026-09-21) : le cron de fond passe toutes les 30 min, donc une
 * fenêtre de 5 min était presque toujours ratée et le renouvellement n'était tenté qu'une fois
 * l'access token DÉJÀ MORT. Or le repli `renewAccessToken` exige un access token encore vivant :
 * une fois expiré, un unique refus de refresh condamnait la connexion. Avec 40 min > 30 min de
 * cadence, tout passage du cron tombe dans la fenêtre et le filet reste disponible.
 */
const REFRESH_MARGIN_MS = 40 * 60 * 1000;
/**
 * Un refus de refresh (`HTTP 200 invalid_token`) n'est PAS la preuve d'un token mort : mesuré en
 * prod, Tradovate refuse parfois un refresh_token jamais utilisé, émis 2 h plus tôt et qu'il
 * déclare lui-même valide 26 h. On réessaie donc une fois, après ce délai, en relisant la
 * connexion : si un autre worker (ou une connexion sœur du même login) a renouvelé entre-temps,
 * la base porte déjà un token frais et le réessai n'a même pas besoin d'appeler Tradovate.
 */
const REFRESH_RETRY_DELAY_MS = 2_000;
/**
 * Verrou par connexion, partagé par la synchro et le cron de renouvellement : Tradovate FAIT
 * TOURNER le refresh_token à chaque renouvellement. Deux renouvellements simultanés = l'un
 * présente un token déjà remplacé, se voit refuser, et la connexion passerait à tort en
 * « à reconnecter ».
 */
const LOCK_TTL_S = 120;
const ENVS: TradovateEnv[] = ['live', 'demo'];

/**
 * Devise posée sur le TradingAccount lié à un compte Tradovate (PROMPT-214) : la devise d'un compte
 * synchronisé vient du broker et n'est plus modifiable par l'utilisateur (AccountsService.update).
 *
 * Elle est désormais LUE chez le broker, plus supposée : `cashBalance.currencyId` du compte, puis
 * `/currency/item?id=` pour son code (cf. `resolveAccountCurrency`). Piège confirmé le 2026-09-20 sur
 * un compte réel : `currencyId` est un identifiant INTERNE Tradovate (1 = USD, 2 = EUR…), jamais un
 * code ISO 4217 — le prendre pour un code, ou le mapper de tête, donne une devise fausse en silence.
 *
 * Repli quand la lecture échoue ou que la devise n'est pas gérée par MTC : `DEFAULT_ACCOUNT_CURRENCY`
 * (USD), la devise de tous les comptes Tradovate vus à ce jour (futures CME, prop firms).
 */
const FALLBACK_ACCOUNT_CURRENCY: AccountCurrency = DEFAULT_ACCOUNT_CURRENCY;

/** Vue publique d'une connexion : JAMAIS de token, même chiffré. */
export interface TradovateConnectionView {
  accountId: string;
  status: BrokerConnectionStatus;
  externalAccountId: string | null;
  externalAccountName: string | null;
  externalEnv: string | null;
  availableAccounts: ExternalAccountRef[];
  /** true si plusieurs comptes Tradovate et aucun choisi : la synchro attend un choix. */
  needsAccountSelection: boolean;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  tradesImported: number;
  connectedAt: Date;
}

/**
 * Issue du callback. Lue par le front dans l'URL de retour (`?tradovate=…&reason=…`), et
 * par le controller qui enchaîne la première synchro quand un compte est déjà choisi.
 * `origin` décide de la page de retour : l'utilisateur revient là d'où il est parti.
 */
export type CallbackOutcome =
  | { status: 'connected' | 'select_account'; accountId: string; userId: string; origin: OAuthOrigin }
  | { status: 'error'; reason: string; accountId?: string; origin: OAuthOrigin };

/** Résumé de la première synchro, ajouté à l'URL de retour (jamais bloquant). */
export interface FirstSyncSummary {
  /** Trades créés ; null = la synchro a échoué (la connexion, elle, est faite). */
  created: number | null;
  /** 'ok' rapprochés · 'partial' incomplets · 'none' indisponibles (P&L brut). */
  fees?: 'ok' | 'partial' | 'none';
}

/**
 * Cycle de vie d'une connexion Tradovate PAR TradingAccount (PROMPT-207) : consentement OAuth,
 * échange du code côté serveur, stockage chiffré des tokens, renouvellement sans nouveau
 * consentement, choix du compte broker, déconnexion.
 *
 * MTC ne voit jamais le mot de passe Tradovate : l'utilisateur s'authentifie chez Tradovate,
 * MTC ne reçoit qu'un code puis des tokens révocables, en lecture seule.
 */
@Injectable()
export class TradovateConnectionService {
  private readonly logger = new Logger(TradovateConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: TradovateApiClient,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

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
      const tokens = await this.api.exchangeCode(query.code);
      const available = await this.discoverAccounts(tokens.access_token as string);
      const conn = await this.saveConnection(userId, accountId, tokens, available);
      if (available.length === 0) return { status: 'error', reason: 'no_account', accountId, origin };
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

  /** Comptes accessibles avec ce token, sur les deux hôtes (réels + simulés). */
  private async discoverAccounts(accessToken: string): Promise<ExternalAccountRef[]> {
    const found: ExternalAccountRef[] = [];
    let lastError: unknown = null;
    for (const env of ENVS) {
      try {
        const list = await this.api.get<TradovateAccount[]>(env, '/account/list', accessToken);
        for (const a of Array.isArray(list) ? list : []) {
          if (a.closed) continue; // compte fermé : plus rien à synchroniser
          found.push({ id: String(a.id), name: a.name, env });
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

  private async saveConnection(
    userId: string,
    accountId: string,
    tokens: TradovateOAuthTokenResponse,
    available: ExternalAccountRef[],
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
      ...this.tokenColumns(tokens),
      externalAccountId: chosen?.id ?? null,
      externalAccountName: chosen?.name ?? null,
      externalEnv: chosen?.env ?? null,
      availableAccounts: available as unknown as Prisma.InputJsonValue,
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
      await this.syncAccountCurrency(accountId, saved, chosen, tokens.access_token as string);
    }
    return saved;
  }

  // ── Gestion ───────────────────────────────────────────────────────────────

  async list(userId: string): Promise<TradovateConnectionView[]> {
    const rows = await this.prisma.brokerConnection.findMany({
      where: { userId, provider: BrokerProvider.TRADOVATE },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /** Choix du compte Tradovate à synchroniser vers ce TradingAccount. */
  async selectAccount(
    userId: string,
    accountId: string,
    externalAccountId: string,
  ): Promise<TradovateConnectionView> {
    const conn = await this.getConnection(userId, accountId);
    const target = this.available(conn).find((a) => a.id === externalAccountId);
    if (!target) throw new TradovateException('TRADOVATE_ACCOUNT_NOT_FOUND');
    const updated = await this.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: {
        externalAccountId: target.id,
        externalAccountName: target.name,
        externalEnv: target.env,
      },
    });
    // La devise du compte suit le broker, lue chez lui (cf. resolveAccountCurrency).
    await this.syncAccountCurrency(accountId, conn, target);
    return this.toView(updated);
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
    knownToken?: string,
  ): Promise<void> {
    const accessToken = knownToken ?? (await this.getAccessToken(conn).catch(() => null));
    if (!accessToken) {
      this.logger.warn(`Devise du compte ${target.id} non relue : aucun token exploitable.`);
      return;
    }
    const currency = await this.resolveAccountCurrency(target, accessToken);
    await this.prisma.tradingAccount.update({ where: { id: accountId }, data: { currency } });
  }

  /**
   * Devise réelle d'un compte Tradovate : `cashBalance.currencyId` → `/currency/item?id=`.
   *
   * `currencyId` est un identifiant interne (1 = USD, 2 = EUR…), donc seul `/currency/item` donne le
   * code : aucune table de correspondance en dur ici, elle finirait fausse. Ne lève jamais — toute
   * lecture ratée ou devise hors `ACCOUNT_CURRENCIES` retombe sur le repli, en le signalant.
   */
  private async resolveAccountCurrency(
    target: ExternalAccountRef,
    accessToken: string,
  ): Promise<AccountCurrency> {
    try {
      const balances = await this.api.get<TradovateCashBalance[]>(
        target.env,
        '/cashBalance/list',
        accessToken,
      );
      const balance = (Array.isArray(balances) ? balances : []).find(
        (b) => String(b.accountId) === target.id,
      );
      if (!balance?.currencyId) {
        this.logger.warn(`Aucun cashBalance pour le compte ${target.id} : repli ${FALLBACK_ACCOUNT_CURRENCY}.`);
        return FALLBACK_ACCOUNT_CURRENCY;
      }
      const currency = await this.api.get<TradovateCurrency>(
        target.env,
        '/currency/item',
        accessToken,
        { id: String(balance.currencyId) },
      );
      const code = normalizeCurrencyCode(currency?.name);
      if (!isAccountCurrency(code)) {
        this.logger.warn(
          `Devise Tradovate « ${code ?? '?'} » (currencyId ${balance.currencyId}) non gérée par MTC : repli ${FALLBACK_ACCOUNT_CURRENCY}.`,
        );
        return FALLBACK_ACCOUNT_CURRENCY;
      }
      return code;
    } catch (err) {
      this.logger.warn(
        `Devise du compte Tradovate ${target.id} illisible (${(err as Error).message}) : repli ${FALLBACK_ACCOUNT_CURRENCY}.`,
      );
      return FALLBACK_ACCOUNT_CURRENCY;
    }
  }

  /**
   * Déconnexion : les tokens sont SUPPRIMÉS de la base (pas seulement désactivés). La Trade API
   * n'expose pas d'endpoint de révocation documenté ; sans token stocké, MTC ne peut plus rien
   * lire. Les trades déjà importés restent (ce sont ceux de l'utilisateur).
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

  // ── Tokens ────────────────────────────────────────────────────────────────

  /**
   * Access token valide pour cette connexion, renouvelé si besoin SANS repasser par l'écran
   * de consentement : refresh_token d'abord, puis `renewAccessToken` si l'access token vit
   * encore. Si tout échoue → connexion marquée NEEDS_RECONNECT et erreur claire.
   */
  async getAccessToken(conn: BrokerConnection): Promise<string> {
    if (conn.status === BrokerConnectionStatus.NEEDS_RECONNECT) {
      throw new TradovateException('TRADOVATE_RECONNECT_REQUIRED');
    }
    const now = Date.now();
    const current = decryptToken(conn.accessTokenEnc, this.tokenKey());
    if (conn.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > now) return current;

    // `refreshTokenExpiresAt` n'est PAS une autorité : Tradovate refuse parfois avant l'échéance
    // qu'il annonce. On tente donc dès qu'un refresh_token existe, et c'est sa réponse qui tranche.
    const refreshed = conn.refreshTokenEnc ? await this.refreshWithRetry(conn) : null;
    if (refreshed) return refreshed;

    const renewed = await this.tryRenew(conn, current);
    if (renewed) return renewed;

    await this.markNeedsReconnect(conn.id);
    throw new TradovateException('TRADOVATE_RECONNECT_REQUIRED');
  }

  /**
   * Refresh avec UNE seconde tentative espacée : un premier `invalid_token` ne condamne plus la
   * connexion (bug prod du 2026-09-21, 4 comptes de Val perdus sur un refus unique).
   *
   * `null` = Tradovate a refusé deux fois, l'appelant décide de la suite (repli renew). Une panne
   * réseau ou une limite de débit LÈVE au contraire : on ne dégrade jamais une connexion pour
   * une indisponibilité.
   */
  private async refreshWithRetry(conn: BrokerConnection): Promise<string | null> {
    try {
      return await this.refreshWithToken(conn);
    } catch (err) {
      if (!(err instanceof TradovateApiError)) throw err;
      if (err.kind !== 'unauthorized') throw err.toException();
      this.logger.warn(
        `refresh_token Tradovate refusé (connexion ${conn.id}) : 2e tentative dans ${REFRESH_RETRY_DELAY_MS} ms.`,
      );
    }

    await this.wait(REFRESH_RETRY_DELAY_MS);

    // Relecture : un autre worker du cluster a pu renouveler pendant l'attente. Son access token
    // est alors déjà en base, et le réessai n'a plus lieu d'être.
    const fresh = await this.prisma.brokerConnection.findUnique({ where: { id: conn.id } });
    if (!fresh || fresh.status === BrokerConnectionStatus.NEEDS_RECONNECT) return null;
    if (fresh.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
      this.logger.log(`Token Tradovate déjà renouvelé ailleurs (connexion ${conn.id}).`);
      return decryptToken(fresh.accessTokenEnc, this.tokenKey());
    }
    if (!fresh.refreshTokenEnc) return null;

    try {
      return await this.refreshWithToken(fresh);
    } catch (err) {
      if (!(err instanceof TradovateApiError)) throw err;
      if (err.kind !== 'unauthorized') throw err.toException();
      this.logger.warn(`refresh_token Tradovate refusé 2 fois (connexion ${conn.id}) : repli renew.`);
      return null;
    }
  }

  /**
   * Repli natif Tradovate : prolonge un access token ENCORE VIVANT. C'est le filet du refresh,
   * d'où la marge de 40 min — expiré, ce chemin n'existe plus. `null` = pas de filet disponible.
   */
  private async tryRenew(conn: BrokerConnection, current: string): Promise<string | null> {
    if (conn.accessTokenExpiresAt.getTime() <= Date.now()) return null;
    try {
      const renewed = await this.api.renewAccessToken(current);
      await this.prisma.brokerConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptToken(renewed.accessToken, this.tokenKey()),
          accessTokenExpiresAt: new Date(renewed.expirationTime),
        },
      });
      return renewed.accessToken;
    } catch (err) {
      if (err instanceof TradovateApiError && err.kind !== 'unauthorized') throw err.toException();
      return null;
    }
  }

  /** Point d'attente isolé : les tests le remplacent pour ne pas dormir 2 s. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Renouvellement IMMÉDIAT par refresh_token, sans lire de données (cron de maintien).
   * `reconnect` = Tradovate refuse le refresh_token (expiré, révoqué) : la connexion est
   * marquée à reconnecter. `retry` = Tradovate injoignable ou limité : on ne touche à rien,
   * le passage suivant réessaiera — jamais de connexion dégradée pour une panne réseau.
   */
  async refreshNow(conn: BrokerConnection): Promise<'refreshed' | 'reconnect' | 'retry'> {
    if (!conn.refreshTokenEnc) {
      await this.markNeedsReconnect(conn.id);
      return 'reconnect';
    }
    try {
      // Même exigence que la synchro : deux refus ET aucun repli avant de condamner.
      if (await this.refreshWithRetry(conn)) return 'refreshed';
      const current = decryptToken(conn.accessTokenEnc, this.tokenKey());
      if (await this.tryRenew(conn, current)) return 'refreshed';
      await this.markNeedsReconnect(conn.id);
      return 'reconnect';
    } catch (err) {
      this.logger.warn(`Renouvellement Tradovate reporté (connexion ${conn.id}) : ${(err as Error).message}`);
      return 'retry';
    }
  }

  /** Échange le refresh_token (rotation incluse) et persiste les nouveaux tokens chiffrés. */
  private async refreshWithToken(conn: BrokerConnection): Promise<string> {
    const tokens = await this.api.refresh(decryptToken(conn.refreshTokenEnc as string, this.tokenKey()));
    await this.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: this.tokenColumns(tokens, conn),
    });
    return tokens.access_token as string;
  }

  /** Verrou de la connexion (cf. LOCK_TTL_S). Redis indisponible → on laisse passer. */
  async tryLock(connectionId: string): Promise<boolean> {
    try {
      return (await this.redis.client.set(`tradovate:sync:${connectionId}`, '1', 'EX', LOCK_TTL_S, 'NX')) === 'OK';
    } catch (err) {
      this.logger.warn(`Verrou Tradovate indisponible (${(err as Error).message}), on continue.`);
      return true;
    }
  }

  async unlock(connectionId: string): Promise<void> {
    try {
      await this.redis.client.del(`tradovate:sync:${connectionId}`);
    } catch {
      // expirera seul (TTL)
    }
  }

  async markNeedsReconnect(connectionId: string): Promise<void> {
    await this.prisma.brokerConnection.update({
      where: { id: connectionId },
      data: {
        status: BrokerConnectionStatus.NEEDS_RECONNECT,
        lastSyncError: 'Connexion expirée ou révoquée : reconnecte ton compte Tradovate.',
      },
    });
  }

  private tokenColumns(
    tokens: TradovateOAuthTokenResponse,
    previous?: Pick<BrokerConnection, 'refreshTokenEnc' | 'refreshTokenExpiresAt'>,
  ) {
    const key = this.tokenKey();
    const now = Date.now();
    return {
      accessTokenEnc: encryptToken(tokens.access_token as string, key),
      accessTokenExpiresAt: new Date(now + (tokens.expires_in ?? 4800) * 1000),
      // Un refresh qui ne renvoie pas de nouveau refresh_token garde l'ancien.
      refreshTokenEnc: tokens.refresh_token
        ? encryptToken(tokens.refresh_token, key)
        : (previous?.refreshTokenEnc ?? null),
      refreshTokenExpiresAt: tokens.refresh_token
        ? tokens.refresh_token_expires_in
          ? new Date(now + tokens.refresh_token_expires_in * 1000)
          : null
        : (previous?.refreshTokenExpiresAt ?? null),
    };
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

  private available(conn: BrokerConnection): ExternalAccountRef[] {
    return Array.isArray(conn.availableAccounts)
      ? (conn.availableAccounts as unknown as ExternalAccountRef[])
      : [];
  }

  private toView(conn: BrokerConnection): TradovateConnectionView {
    const availableAccounts = this.available(conn);
    return {
      accountId: conn.accountId,
      status: conn.status,
      externalAccountId: conn.externalAccountId,
      externalAccountName: conn.externalAccountName,
      externalEnv: conn.externalEnv,
      availableAccounts,
      needsAccountSelection: !conn.externalAccountId && availableAccounts.length > 1,
      lastSyncAt: conn.lastSyncAt,
      lastSyncError: conn.lastSyncError,
      tradesImported: conn.tradesImported,
      connectedAt: conn.createdAt,
    };
  }

  /**
   * URL de retour dans l'app. Wizard → `/dashboard` (l'overlay d'onboarding s'y rouvre et
   * reprend à l'écran final, `from=wizard`) ; réglages → `/accounts`. Le front nettoie ces
   * paramètres une fois lus.
   */
  frontendRedirect(outcome: CallbackOutcome, sync?: FirstSyncSummary): string {
    const base = this.config.get<string>('FRONTEND_URL') ?? 'https://app.mytradingcoach.app';
    const params = new URLSearchParams({ tradovate: outcome.status });
    if (outcome.accountId) params.set('accountId', outcome.accountId);
    if (outcome.status === 'error') params.set('reason', outcome.reason);
    if (sync) {
      if (sync.created === null) params.set('sync', 'error');
      else params.set('trades', String(sync.created));
      if (sync.fees) params.set('fees', sync.fees);
    }
    if (outcome.origin === 'wizard') {
      params.set('from', 'wizard');
      return `${base}/dashboard?${params.toString()}`;
    }
    return `${base}/accounts?${params.toString()}`;
  }

  private tokenKey(): Buffer {
    return loadTokenKey(this.config.get<string>('BROKER_TOKEN_ENCRYPTION_KEY'));
  }

  private stateSecret(): string {
    return this.config.get<string>('JWT_SECRET') ?? process.env['JWT_SECRET'] ?? '';
  }
}
