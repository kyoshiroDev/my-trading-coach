import type { Logger } from '@nestjs/common';
import { isAccountCurrency, normalizeCurrencyCode } from '@mtc/shared';
import type { AccountCurrency } from '@mtc/shared';
import type { TradovateApiClient } from './tradovate-api.client';
import type { ExternalAccountRef, TradovateCashBalance, TradovateCurrency } from './tradovate.types';
import { FALLBACK_ACCOUNT_CURRENCY } from './tradovate-connection.constants';

/**
 * Devise réelle d'un compte Tradovate : `cashBalance.currencyId` → `/currency/item?id=`.
 *
 * `currencyId` est un identifiant interne (1 = USD, 2 = EUR…), donc seul `/currency/item` donne le
 * code : aucune table de correspondance en dur ici, elle finirait fausse. Ne lève jamais — toute
 * lecture ratée ou devise hors `ACCOUNT_CURRENCIES` retombe sur le repli, en le signalant.
 */
export async function resolveAccountCurrency(
api: TradovateApiClient,
logger: Logger,
target: ExternalAccountRef,
accessToken: string,
apiHosts?: unknown,
): Promise<AccountCurrency> {
  try {
    const balances = await api.get<TradovateCashBalance[]>(
      target.env,
      '/cashBalance/list',
      accessToken,
      undefined,
      apiHosts,
    );
    const balance = (Array.isArray(balances) ? balances : []).find(
      (b) => String(b.accountId) === target.id,
    );
    if (!balance?.currencyId) {
      logger.warn(`Aucun cashBalance pour le compte ${target.id} : repli ${FALLBACK_ACCOUNT_CURRENCY}.`);
      return FALLBACK_ACCOUNT_CURRENCY;
    }
    const currency = await api.get<TradovateCurrency>(
      target.env,
      '/currency/item',
      accessToken,
      { id: String(balance.currencyId) },
      apiHosts,
    );
    const code = normalizeCurrencyCode(currency?.name);
    if (!isAccountCurrency(code)) {
      logger.warn(
        `Devise Tradovate « ${code ?? '?'} » (currencyId ${balance.currencyId}) non gérée par MTC : repli ${FALLBACK_ACCOUNT_CURRENCY}.`,
      );
      return FALLBACK_ACCOUNT_CURRENCY;
    }
    return code;
  } catch (err) {
    logger.warn(
      `Devise du compte Tradovate ${target.id} illisible (${(err as Error).message}) : repli ${FALLBACK_ACCOUNT_CURRENCY}.`,
    );
    return FALLBACK_ACCOUNT_CURRENCY;
  }
}
