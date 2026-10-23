import type { TraderPushMessage } from './trader-push-messages';

/**
 * Nom du compte sur l'écran verrouillé (#717, décision de Greg) : JAMAIS le libellé saisi par le
 * trader (il peut contenir son nom, un numéro de compte). Construit depuis le catalogue prop firm,
 * firme et taille (« Apex 50K »), « compte 2 », « compte 3 »… pour les suivants de même firme et
 * même taille (ordre de création), « ton compte » sans plan relié. Fonctions PURES.
 *
 * Les textes portent le repère `ACCOUNT_TOKEN`, remplacé par `TraderNotifier` juste avant l'envoi.
 */

export const ACCOUNT_TOKEN = '{compte}';
export const UNNAMED_ACCOUNT = 'ton compte';

export interface PushNamedAccount {
  id: string;
  propFirmPlan: { accountSize: number; firm: { name: string } } | null;
}

/** 50 000 → « 50K », 7 500 → « 7,5K », 1 000 000 → « 1M ». */
export function formatAccountSize(size: number): string {
  if (size >= 1_000_000 && size % 1_000_000 === 0) return `${size / 1_000_000}M`;
  if (size % 1000 === 0) return `${size / 1000}K`;
  return `${(size / 1000).toFixed(1).replace('.', ',')}K`;
}

const catalogName = (a: PushNamedAccount) =>
  a.propFirmPlan ? `${a.propFirmPlan.firm.name} ${formatAccountSize(a.propFirmPlan.accountSize)}` : null;

/** `accounts` : tous les comptes du trader, dans l'ordre de création. */
export function accountPushName(accounts: PushNamedAccount[], accountId: string): string {
  const target = accounts.find((a) => a.id === accountId);
  const name = target ? catalogName(target) : null;
  if (!name) return UNNAMED_ACCOUNT;
  const rank = accounts.filter((a) => catalogName(a) === name).findIndex((a) => a.id === accountId) + 1;
  return rank > 1 ? `${name} compte ${rank}` : name;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Remplace le repère ; un titre qui commence par « ton compte » prend une majuscule. */
export function withAccountName(message: TraderPushMessage, name: string): TraderPushMessage {
  return {
    ...message,
    title: capitalize(message.title.split(ACCOUNT_TOKEN).join(name)),
    body: message.body.split(ACCOUNT_TOKEN).join(name),
  };
}
