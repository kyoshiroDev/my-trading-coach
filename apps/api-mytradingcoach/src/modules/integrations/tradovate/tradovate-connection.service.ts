import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrokerConnection,
  BrokerConnectionStatus,
  BrokerProvider,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
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
  TradovateUser,
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
/**
 * Verrou du LOGIN, plus étroit que celui de la connexion et posé autour du seul renouvellement.
 *
 * Tradovate fait tourner le refresh_token par LOGIN (son `userId`), pas par compte. Or un login
 * peut porter plusieurs comptes, donc plusieurs connexions MTC, chacune avec sa copie des tokens :
 * dès que l'une renouvelle, les copies des autres sont mortes. Le verrou par connexion ne les
 * sérialisait pas — c'est ce qui a tué 2 des 5 connexions d'un ambassadeur (prod, 21-23/09).
 * TTL court : un renouvellement, c'est un aller-retour HTTP, pas une synchro.
 */
const LOGIN_LOCK_TTL_S = 30;
/**
 * Un compte absent de `/account/list` n'est déclaré disparu qu'après ce délai sans synchro réussie
 * (bug prod du 2026-09-26 : un compte de Val a disparu du login pendant la maintenance Tradovate du
 * week-end). Le cron passe toutes les 15 min : un trou passager de la liste ne détache rien.
 */
export const ACCOUNT_GONE_GRACE_MS = 2 * 60 * 60 * 1000;
/**
 * Après un refus « passager » (refresh_token encore promis), on ne rappelle PAS Tradovate avant ce
 * délai, quel que soit l'appelant. Sans ça, le WebSocket (backoff plafonné à 60 s) redemandait un
 * refresh deux fois par minute pendant des heures — constaté en beta le 2026-09-26 : de quoi se
 * faire limiter, voire signaler, par Tradovate. Les crons (15 min, 1 h) retentent au-delà.
 */
export const REFUSAL_COOLDOWN_S = 10 * 60;
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
      // Garde-fou : on ne propose JAMAIS un compte déjà relié par un autre utilisateur MTC.
      // Filtré avant le choix, donc ni choisi automatiquement, ni offert à l'écran de sélection.
      const libres = await this.dropAlreadyLinked(userId, available);
      if (available.length === 0) return { status: 'error', reason: 'no_account', accountId, origin };
      if (libres.length === 0) {
        return { status: 'error', reason: 'account_already_linked', accountId, origin };
      }
      const login = await this.discoverLogin(tokens.access_token as string, libres);
      const conn = await this.saveConnection(userId, accountId, tokens, libres, login);
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
  ): Promise<string | null> {
    // Les hôtes où ce jeton a effectivement répondu, sinon les deux.
    const envs = available.length ? [...new Set(available.map((a) => a.env))] : [...ENVS];
    for (const env of envs) {
      try {
        const users = await this.api.get<TradovateUser[]>(env, '/user/list', accessToken);
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
      // Le login : l'utilisateur AUTHENTIFIÉ, pas le propriétaire du compte (cf. discoverLogin).
      // Il sert à sérialiser les renouvellements et à propager le jeton aux connexions sœurs.
      externalUserId: login,
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

    // Refus tout récent et toujours promis : on n'insiste pas auprès de Tradovate (cf. REFUSAL_COOLDOWN_S).
    if (this.refreshStillPromised(conn) && (await this.inRefusalCooldown(conn))) {
      throw new TradovateException('TRADOVATE_REFRESH_DEFERRED');
    }

    // `refreshTokenExpiresAt` n'est PAS une autorité : Tradovate refuse parfois avant l'échéance
    // qu'il annonce. On tente donc dès qu'un refresh_token existe, et c'est sa réponse qui tranche.
    const refreshed = conn.refreshTokenEnc ? await this.refreshWithRetry(conn) : null;
    if (refreshed) return refreshed;

    const renewed = await this.tryRenew(conn, current);
    if (renewed) return renewed;

    if (this.refreshStillPromised(conn)) {
      this.logger.warn(
        `Tradovate refuse le renouvellement (connexion ${conn.id}) alors que son refresh_token vit jusqu'au ` +
          `${conn.refreshTokenExpiresAt?.toISOString()} : connexion gardée, nouvel essai dans ${REFUSAL_COOLDOWN_S / 60} min.`,
      );
      await this.startRefusalCooldown(conn);
      throw new TradovateException('TRADOVATE_REFRESH_DEFERRED');
    }
    await this.markNeedsReconnect(conn.id, 'refresh refusé deux fois, renew impossible, refresh_token échu ou de durée inconnue');
    throw new TradovateException('TRADOVATE_RECONNECT_REQUIRED');
  }

  /**
   * Un refus n'est une preuve de mort QUE si Tradovate ne promet plus rien : tant que le
   * refresh_token est annoncé valide, un refus est traité comme passager (mesuré en prod : refus
   * d'un token frais, accepté plus tard). La connexion n'est donc condamnée qu'à l'échéance
   * annoncée, soit au pire ~25 h après le dernier renouvellement réussi. Échéance inconnue
   * (`null`) → on ne peut rien promettre, le refus tranche.
   */
  private refreshStillPromised(conn: BrokerConnection): boolean {
    return !!conn.refreshTokenEnc && !!conn.refreshTokenExpiresAt && conn.refreshTokenExpiresAt.getTime() > Date.now();
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
    // Sérialisé PAR LOGIN : deux connexions sœurs qui renouvellent en même temps s'invalident.
    const held = await this.tryLoginLock(conn);
    if (!held) {
      const partage = await this.awaitSiblingRefresh(conn);
      if (partage) return partage;
      // La sœur n'a rien donné (échec de son côté, ou login inconnu) : on tente quand même,
      // comme avant. Mieux vaut un refus possible qu'une connexion bloquée par un verrou.
    }
    try {
      return await this.refreshWithRetryLocked(conn);
    } finally {
      if (held) await this.unlockLogin(conn);
    }
  }

  private async refreshWithRetryLocked(conn: BrokerConnection): Promise<string | null> {
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
      await this.markNeedsReconnect(conn.id, 'aucun refresh_token stocké');
      return 'reconnect';
    }
    if (this.refreshStillPromised(conn) && (await this.inRefusalCooldown(conn))) return 'retry';
    try {
      // Même exigence que la synchro : deux refus ET aucun repli avant de condamner.
      if (await this.refreshWithRetry(conn)) return 'refreshed';
      const current = decryptToken(conn.accessTokenEnc, this.tokenKey());
      if (await this.tryRenew(conn, current)) return 'refreshed';
      if (this.refreshStillPromised(conn)) {
        this.logger.warn(`Renouvellement Tradovate refusé mais refresh_token encore valide (connexion ${conn.id}) : reporté.`);
        await this.startRefusalCooldown(conn);
        return 'retry';
      }
      await this.markNeedsReconnect(conn.id, 'cron : refresh refusé deux fois, refresh_token échu ou de durée inconnue');
      return 'reconnect';
    } catch (err) {
      this.logger.warn(`Renouvellement Tradovate reporté (connexion ${conn.id}) : ${(err as Error).message}`);
      return 'retry';
    }
  }

  /**
   * Seconde chance d'une connexion « à reconnecter » dont le refresh_token est encore annoncé
   * valide : condamnée à tort (refus passager, rotation d'une sœur avant le verrou par login).
   * Un renouvellement réussi la remet CONNECTED sans rien demander à l'utilisateur.
   */
  async tryRevive(conn: BrokerConnection): Promise<boolean> {
    if (conn.status !== BrokerConnectionStatus.NEEDS_RECONNECT || !this.refreshStillPromised(conn)) return false;
    try {
      const held = await this.tryLoginLock(conn);
      try {
        await this.refreshWithToken(conn);
      } finally {
        if (held) await this.unlockLogin(conn);
      }
    } catch (err) {
      this.logger.warn(`Connexion Tradovate ${conn.id} toujours refusée : ${(err as Error).message}`);
      return false;
    }
    await this.prisma.brokerConnection.update({
      where: { id: conn.id },
      data: { status: BrokerConnectionStatus.CONNECTED, lastSyncError: null },
    });
    this.logger.log(`Connexion Tradovate ${conn.id} ressuscitée : le login a de nouveau accepté le refresh.`);
    return true;
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
  async handleMissingAccount(conn: BrokerConnection, accessToken: string): Promise<BrokerConnection> {
    const available = await this.discoverAccounts(accessToken);
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

  /**
   * Échange le refresh_token (rotation incluse), persiste les nouveaux tokens chiffrés, puis les
   * PROPAGE aux connexions sœurs du même login : elles détiennent la même autorisation OAuth, et
   * sans ça leur copie vient d'être invalidée par cette rotation.
   */
  private async refreshWithToken(conn: BrokerConnection): Promise<string> {
    const tokens = await this.api.refresh(decryptToken(conn.refreshTokenEnc as string, this.tokenKey()));
    const columns = this.tokenColumns(tokens, conn);
    await this.prisma.brokerConnection.update({ where: { id: conn.id }, data: columns });
    await this.clearRefusalCooldown(conn);
    await this.propagateToSiblings(conn, columns);
    return tokens.access_token as string;
  }

  /**
   * Diffuse les tokens fraîchement obtenus à toutes les connexions du MÊME login (même user MTC,
   * même `externalUserId`). Une sœur passée « à reconnecter » par une rotation concurrente l'a été
   * à tort : le login vient de répondre, donc elle repart CONNECTED.
   *
   * Sans `externalUserId` (connexions d'avant cette correction), on ne sait pas qui est sœur de qui :
   * on ne propage rien plutôt que de deviner.
   */
  private async propagateToSiblings(
    conn: BrokerConnection,
    columns: ReturnType<TradovateConnectionService['tokenColumns']>,
  ): Promise<number> {
    if (!conn.externalUserId) return 0;
    const { count } = await this.prisma.brokerConnection.updateMany({
      where: {
        id: { not: conn.id },
        userId: conn.userId,
        provider: BrokerProvider.TRADOVATE,
        externalUserId: conn.externalUserId,
      },
      data: { ...columns, status: BrokerConnectionStatus.CONNECTED, lastSyncError: null },
    });
    if (count > 0) {
      this.logger.log(`Token Tradovate propagé à ${count} connexion(s) sœur(s) du login ${conn.externalUserId}.`);
    }
    return count;
  }

  /**
   * Rattrapage du login pour les connexions créées avant cette correction : leur `externalUserId`
   * est vide, donc elles ne sont sœurs de personne et ne bénéficient ni du verrou partagé ni de la
   * propagation. La synchro lit déjà `/account/list`, qui porte le `userId` : on le pose au passage,
   * une seule fois, sans appel réseau supplémentaire.
   */
  async rememberLogin(
    conn: BrokerConnection,
    externalUserId: number | undefined,
    accountIdsOfLogin: string[] = [],
  ): Promise<number> {
    if (externalUserId == null) return 0;
    const login = String(externalUserId);
    // Tous les comptes que CE login expose : c'est ce qui permet de rattacher aussi les connexions
    // sœurs DÉJÀ MORTES. Elles ne se synchronisent plus (le cron ignore NEEDS_RECONNECT), donc
    // elles ne passeraient jamais ici d'elles-mêmes et resteraient orphelines — donc jamais
    // ressuscitées par la propagation.
    const ids = accountIdsOfLogin.length
      ? accountIdsOfLogin
      : conn.externalAccountId
        ? [conn.externalAccountId]
        : [];
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.brokerConnection.updateMany({
      where: {
        userId: conn.userId,
        provider: BrokerProvider.TRADOVATE,
        externalUserId: null,
        externalAccountId: { in: ids },
      },
      data: { externalUserId: login },
    });
    if (count > 0) {
      this.logger.log(`Login Tradovate ${login} rattaché à ${count} connexion(s).`);
    }
    return count;
  }

  /** Clé du verrou de renouvellement : le login s'il est connu, sinon la connexion seule. */
  private loginLockKey(conn: BrokerConnection): string {
    return conn.externalUserId ? `tradovate:login:${conn.externalUserId}` : `tradovate:refresh:${conn.id}`;
  }

  /** Verrou de renouvellement. Redis indisponible → on laisse passer (comme `tryLock`). */
  private async tryLoginLock(conn: BrokerConnection): Promise<boolean> {
    try {
      return (await this.redis.client.set(this.loginLockKey(conn), '1', 'EX', LOGIN_LOCK_TTL_S, 'NX')) === 'OK';
    } catch (err) {
      this.logger.warn(`Verrou de login Tradovate indisponible (${(err as Error).message}), on continue.`);
      return true;
    }
  }

  private async unlockLogin(conn: BrokerConnection): Promise<void> {
    try {
      await this.redis.client.del(this.loginLockKey(conn));
    } catch {
      // expirera seul (TTL)
    }
  }

  /**
   * Une connexion sœur renouvelle en ce moment : plutôt que de présenter un refresh_token qu'elle
   * est en train de remplacer, on attend puis on relit. Si elle a propagé, son access token est
   * déjà en base et il n'y a plus rien à demander à Tradovate.
   */
  private async awaitSiblingRefresh(conn: BrokerConnection): Promise<string | null> {
    await this.wait(REFRESH_RETRY_DELAY_MS);
    const fresh = await this.prisma.brokerConnection.findUnique({ where: { id: conn.id } });
    if (!fresh || fresh.status === BrokerConnectionStatus.NEEDS_RECONNECT) return null;
    if (fresh.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
      this.logger.log(`Token Tradovate repris d'une connexion sœur (connexion ${conn.id}).`);
      return decryptToken(fresh.accessTokenEnc, this.tokenKey());
    }
    return null;
  }

  private refusalKey(conn: BrokerConnection): string {
    return `tradovate:refresh-refused:${conn.id}`;
  }

  /** Redis indisponible → pas de pause : on retombe sur le comportement sans garde-fou. */
  private async inRefusalCooldown(conn: BrokerConnection): Promise<boolean> {
    try {
      return (await this.redis.client.exists(this.refusalKey(conn))) === 1;
    } catch {
      return false;
    }
  }

  private async startRefusalCooldown(conn: BrokerConnection): Promise<void> {
    try {
      await this.redis.client.set(this.refusalKey(conn), '1', 'EX', REFUSAL_COOLDOWN_S);
    } catch {
      // sans Redis, pas de pause : les appelants retentent à leur rythme
    }
  }

  private async clearRefusalCooldown(conn: BrokerConnection): Promise<void> {
    try {
      await this.redis.client.del(this.refusalKey(conn));
    } catch {
      // expirera seul (TTL)
    }
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
      // ≥ 1 et non > 1 : au consentement, un compte unique est choisi d'office (jamais ici) ; mais
      // un compte disparu détache la connexion, et le suivant doit être choisi explicitement même
      // s'il est seul — on ne verse pas les trades d'un autre compte broker sans le demander.
      needsAccountSelection: !conn.externalAccountId && availableAccounts.length >= 1,
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
