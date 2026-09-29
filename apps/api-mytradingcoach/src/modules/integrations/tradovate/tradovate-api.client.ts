import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TradovateApiError } from './tradovate.errors';
import type { TradovateEnv, TradovateOAuthTokenResponse } from './tradovate.types';

/**
 * L'OAuth Tradovate passe TOUJOURS par Live (vérifié lors de l'intégration : l'inscription
 * OAuth de MTC n'existe pas en Demo, et l'exemple officiel fait de même). Les DONNÉES, elles,
 * vivent sur deux hôtes : `live` (comptes réels) et `demo` (comptes simulés, dont les comptes
 * de prop firm). D'où deux bases REST, choisies par compte.
 */
export const TRADOVATE_AUTHORIZE_URL = 'https://trader.tradovate.com/oauth';
export const TRADOVATE_TOKEN_URL = 'https://live.tradovateapi.com/auth/oauthtoken';
export const TRADOVATE_API_BASE: Record<TradovateEnv, string> = {
  live: 'https://live.tradovateapi.com/v1',
  demo: 'https://demo.tradovateapi.com/v1',
};

const TIMEOUT_MS = 20_000;

/**
 * Client HTTP bas niveau de la Trade API. LECTURE SEULE : il n'expose que des GET de données
 * et les deux appels d'authentification (échange de code, renouvellement). Aucune méthode
 * d'écriture (ordre, risque, alerte) n'existe ici, et aucune ne doit y être ajoutée : les
 * scopes accordés sont en lecture seule et le contrat NinjaTrader exclut le passage d'ordres.
 */
@Injectable()
export class TradovateApiClient {
  private readonly logger = new Logger(TradovateApiClient.name);

  constructor(private readonly config: ConfigService) {}

  /** Identifiants OAuth présents ? Sinon la fonctionnalité reste désactivée (pas de crash). */
  isConfigured(): boolean {
    return !!(
      this.config.get<string>('TRADOVATE_OAUTH_CLIENT_ID') &&
      this.config.get<string>('TRADOVATE_OAUTH_CLIENT_SECRET') &&
      this.config.get<string>('TRADOVATE_OAUTH_REDIRECT_URI')
    );
  }

  get redirectUri(): string {
    return this.config.get<string>('TRADOVATE_OAUTH_REDIRECT_URI') ?? '';
  }

  /** URL de consentement Tradovate. `state` voyage aussi en cookie (cf. controller). */
  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.get<string>('TRADOVATE_OAUTH_CLIENT_ID') ?? '',
      redirect_uri: this.redirectUri,
      state,
    });
    return `${TRADOVATE_AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Échange du code d'autorisation (payload confirmé en réel, form-encoded). */
  exchangeCode(code: string): Promise<TradovateOAuthTokenResponse> {
    return this.postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
  }

  /**
   * Renouvellement par refresh_token (OAuth2 standard). La réponse de l'échange contient bien
   * un `refresh_token`, non documenté par NinjaTrader : si ce grant est refusé, l'appelant
   * retombe sur `renewAccessToken` tant que l'access token n'a pas expiré.
   */
  refresh(refreshToken: string): Promise<TradovateOAuthTokenResponse> {
    return this.postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Renouvellement natif Tradovate (prolonge la session d'un token encore valide). */
  async renewAccessToken(
    accessToken: string,
  ): Promise<{ accessToken: string; expirationTime: string }> {
    const body = await this.get<{ accessToken?: string; expirationTime?: string }>(
      'live',
      '/auth/renewaccesstoken',
      accessToken,
    );
    if (!body.accessToken || !body.expirationTime) {
      throw new TradovateApiError('unauthorized', 200, 'renouvellement refusé');
    }
    return { accessToken: body.accessToken, expirationTime: body.expirationTime };
  }

  /** GET d'une ressource REST (`/account/list`, `/fillPair/list`…) sur l'hôte du compte. */
  async get<T>(
    env: TradovateEnv,
    path: string,
    accessToken: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    let res: Response;
    try {
      res = await fetch(`${TRADOVATE_API_BASE[env]}${path}${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new TradovateApiError('unavailable', 0, `${path} : ${(err as Error).name}`);
    }
    const body = await this.readJson(res);
    this.assertOk(res.status, body, path);
    return body as T;
  }

  private async postToken(
    fields: Record<string, string>,
  ): Promise<TradovateOAuthTokenResponse> {
    const body = new URLSearchParams({
      ...fields,
      client_id: this.config.get<string>('TRADOVATE_OAUTH_CLIENT_ID') ?? '',
      client_secret: this.config.get<string>('TRADOVATE_OAUTH_CLIENT_SECRET') ?? '',
    });
    let res: Response;
    try {
      res = await fetch(TRADOVATE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new TradovateApiError('unavailable', 0, `oauthtoken : ${(err as Error).name}`);
    }
    const json = (await this.readJson(res)) as TradovateOAuthTokenResponse | null;
    if (!res.ok || !json?.access_token) {
      // Jamais le corps complet dans les logs : il pourrait contenir un token.
      this.logger.warn(
        `oauthtoken ${fields['grant_type']} refusé : HTTP ${res.status} ${json?.error ?? ''}`,
      );
      if (res.status === 429) throw new TradovateApiError('rate_limited', 429, 'oauthtoken');
      if (res.status >= 500) throw new TradovateApiError('unavailable', res.status, 'oauthtoken');
      throw new TradovateApiError('unauthorized', res.status, json?.error ?? 'oauthtoken');
    }
    return json;
  }

  private async readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** Traduit statut + corps Tradovate en erreur typée. */
  private assertOk(status: number, body: unknown, path: string): void {
    const obj = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

    // Pénalité de débit : Tradovate répond un objet { p-ticket, p-time } au lieu des données.
    if (status === 429 || (obj && ('p-ticket' in obj || 'p-time' in obj))) {
      throw new TradovateApiError('rate_limited', status, path);
    }
    if (status === 401) throw new TradovateApiError('unauthorized', status, path);
    if (status === 403) throw new TradovateApiError('forbidden', status, path);
    if (status === 404) throw new TradovateApiError('not_found', status, path);
    if (status >= 400) throw new TradovateApiError('unavailable', status, path);

    // 200 mais échec métier signalé par `errorText`.
    const errorText = obj && typeof obj['errorText'] === 'string' ? obj['errorText'] : '';
    if (errorText) {
      if (/lock|closed|suspend|disabled/i.test(errorText)) {
        throw new TradovateApiError('forbidden', status, errorText);
      }
      if (/expired|token|unauthori[sz]ed|access denied/i.test(errorText)) {
        throw new TradovateApiError('unauthorized', status, errorText);
      }
      throw new TradovateApiError('unavailable', status, errorText);
    }
  }
}
