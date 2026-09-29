import { LucideBitcoin as Bitcoin } from '@lucide/angular';
import type { AccountCurrency, TradingSession } from '@mtc/shared';
import type { CreateAccountPayload, DrawdownType } from '@app/core/api/accounts.api';
import type { TradingStyle } from './onboarding.constants';

/** Types, options et petits utilitaires de saisie du wizard d'onboarding. */

export type Market = 'CRYPTO' | 'FOREX' | 'ACTIONS' | 'MULTI';
export type Goal   = 'DISCIPLINE' | 'PERFORMANCE' | 'PSYCHOLOGIE';
export type Step   = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type MarketOption = {
  value: Market;
  label: string;
  emoji?: string;
  icon?: typeof Bitcoin;
  iconColor?: string;
  desc: string;
};

export const MARKETS: MarketOption[] = [
  { value: 'CRYPTO',  label: 'Crypto',          icon: Bitcoin, iconColor: '#F7931A', desc: 'Bitcoin, Ethereum, altcoins' },
  { value: 'FOREX',   label: 'Forex',            emoji: '💱',                        desc: 'EUR/USD, paires de devises' },
  { value: 'ACTIONS', label: 'Actions',          emoji: '📈',                        desc: 'Actions, ETF, indices' },
  { value: 'MULTI',   label: 'Multi-marchés',    emoji: '🌐',                        desc: 'Je trade plusieurs marchés' },
];

export const GOALS: { value: Goal; label: string; emoji: string; desc: string }[] = [
  { value: 'DISCIPLINE',  label: 'Travailler ma discipline',  emoji: '🎯', desc: 'Respecter mon plan et éviter les trades impulsifs' },
  { value: 'PSYCHOLOGIE', label: 'Maîtriser ma psychologie',  emoji: '🧠', desc: 'Gérer mes émotions, éviter FOMO et revenge trades' },
  { value: 'PERFORMANCE', label: 'Améliorer ma performance',  emoji: '📈', desc: 'Optimiser mon win rate et ma rentabilité globale' },
];

export const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';


export type AccountMode = 'PERSO' | 'PROPFIRM';

/** `null` si vide ou illisible — distingue « non renseigne » de « zero ». */
export function parseNumber(raw: string): number | null {
  const v = parseFloat(raw.replace(',', '.'));
  return isNaN(v) ? null : v;
}

/** Filtre la saisie sur place (chiffres, point, virgule) et renvoie la valeur nettoyee. */
export function numericOnly(input: HTMLInputElement): string {
  input.value = input.value.replace(/[^\d.,]/g, '');
  return input.value;
}

export interface OnboardingProgress {
  step: Step;
  market: Market | null;
  goal: Goal | null;
  /** Devise DU COMPTE créé à l'étape 3, plus une préférence globale. */
  currency: AccountCurrency;
  capital: string;
  accountMode: AccountMode;
  broker: string;
  profitTarget: string;
  maxDrawdown: string;
  drawdownType: DrawdownType;
  style: TradingStyle | null;
  strategy: string;
  sessions: TradingSession[];
  assets: string[];
  favorite: string | null;
}

/** Capital saisi → nombre (virgule acceptée) ; vide, négatif ou illisible → 0. */
export function parseCapital(raw: string): number {
  const parsed = parseFloat(raw.replace(',', '.'));
  return isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

/** Saisie de l'étape « Ton compte » : ce qu'il faut pour créer le compte de trading. */
export interface AccountStepInput {
  mode: AccountMode;
  capital: string;
  broker: string;
  profitTarget: string;
  maxDrawdown: string;
  drawdownType: DrawdownType;
  currency: AccountCurrency;
}

/**
 * Compte créé à la fin de l'étape « Ton compte ». Perso : « Compte principal ». Prop firm :
 * « <broker> #1 » en évaluation, objectif et drawdown seulement s'ils sont renseignés (> 0).
 */
export function accountPayload(input: AccountStepInput): CreateAccountPayload {
  const prop = input.mode === 'PROPFIRM';
  const size = parseCapital(input.capital) || null;
  const brokerName = input.broker.trim();

  const payload: CreateAccountPayload = {
    label: prop && brokerName ? `${brokerName} #1` : 'Compte principal',
    type: prop ? 'EVALUATION' : 'PERSONAL',
    accountSize: size,
    startingBalance: size,
    currency: input.currency,
  };
  if (!prop) return payload;

  if (brokerName) payload.broker = brokerName;
  const target = parseNumber(input.profitTarget);
  if (target != null && target > 0) payload.profitTarget = target;
  const dd = parseNumber(input.maxDrawdown);
  if (dd != null && dd > 0) {
    payload.maxDrawdown = dd;
    payload.drawdownType = input.drawdownType;
  }
  return payload;
}
