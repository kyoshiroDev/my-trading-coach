import { PREMIUM_PRICE_EUR } from '@mtc/shared';

/**
 * FAQ de la home : SOURCE UNIQUE du texte affiché (`FAQ.astro`) et du JSON-LD `FAQPage`
 * (`schema.ts`). Avant, le JSON-LD était recopié à la main et avait déjà divergé.
 * Texte brut uniquement (il sert tel quel dans les données structurées).
 */
export interface FaqItem {
  question: string;
  answer: string;
}

const { monthly, annual } = PREMIUM_PRICE_EUR;

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Quelle est la différence avec un journal de trading classique ?',
    answer:
      "Un journal de trading classique, tu l'ouvres après avoir perdu pour analyser ce qui s'est passé. MTC est un compagnon : il est là avant (il te prépare), pendant (il surveille en temps réel) et après (il débrieffe). C'est le premier outil de trading qui couvre les 3 moments : grâce à l'IA qui connaît ton profil, tes actifs et tes patterns.",
  },
  {
    question: 'Quels marchés sont supportés ?',
    answer:
      'Tous les marchés : Futures CME (NQ, ES, MES, MNQ, 6E, 6B, Gold, Crude Oil : P&L en ticks avec multiplicateurs officiels), Crypto spot et levier (Binance, Bybit, Coinbase…), Forex (toutes paires), Indices CFD, Actions. Un seul journal pour tout, multi-marché natif.',
  },
  {
    question: 'Comment fonctionne le calendrier économique IA ?',
    answer:
      "Chaque matin, MTC récupère les événements économiques du jour (NFP, PMI, décisions Fed, etc.) et les filtre pour tes actifs spécifiques. Tu vois uniquement ce qui te concerne : NQ, BTC/USDT, EUR/USD. Quand un résultat tombe en cours de session, l'IA analyse immédiatement la surprise et t'indique l'impact probable sur chacun de tes actifs (bull/bear/neutre).",
  },
  {
    question: 'Puis-je importer mon historique de trades ?',
    answer:
      "Oui. Si tu trades sur Tradovate, tu peux connecter ton compte directement : tes trades et leurs frais se synchronisent automatiquement, en lecture seule (MyTradingCoach ne voit jamais ton mot de passe et ne peut passer aucun ordre). Pour les autres brokers (Binance, Bybit, MetaTrader 4/5, IBKR…), l'import CSV fonctionne avec tout broker qui exporte ses trades : il détecte automatiquement le format et structure ton historique. L'import CSV reste aussi disponible pour Tradovate.",
  },
  {
    question: 'Comment fonctionne le trial ?',
    answer:
      "L'abonnement Premium mensuel offre 1 mois d'essai (carte requise, aucun prélèvement avant la fin). Tu peux annuler en un clic depuis les paramètres, sans frais : si tu annules pendant l'essai, tu reviens au plan Gratuit à la fin du mois. L'abonnement annuel est facturé immédiatement, sans période d'essai.",
  },
  {
    question: 'Quelle est la différence entre Gratuit et Premium ?',
    answer: `Le plan Gratuit couvre tout le quotidien : journal illimité, trades illimités, pré-session matin, session live avec trade rapide, débrief de session, 1 compte avec ses règles prop firm, et l'IA mutualisée (calendrier éco avec analyse IA, news live et contexte marché en temps réel : DXY, taux US, indices). Le plan Premium (${monthly}€/mois ou ${annual}€/an) ajoute l'IA personnelle et la profondeur : IA Insights, Chat coach personnalisé, Weekly Debrief automatique, score trader, analytics avancés et comptes illimités avec leurs règles prop firm.`,
  },
  {
    question: 'Où sont hébergées mes données ?',
    answer:
      "Tes données sont hébergées en France sur des serveurs OVH (Roubaix). Elles ne sont jamais vendues ni partagées avec des tiers. L'IA utilisée est Claude d'Anthropic : tes données ne sont pas utilisées pour entraîner leurs modèles.",
  },
];
