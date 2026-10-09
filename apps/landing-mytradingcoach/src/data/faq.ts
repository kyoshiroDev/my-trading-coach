import { FOUNDER_OFFER, FOUNDER_REFUND_DAYS, PREMIUM_PRICE_EUR } from '@mtc/shared';

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
const founder = FOUNDER_OFFER;

export const FAQ: readonly FaqItem[] = [
  {
    question: 'Quelle est la différence avec un journal de trading classique ?',
    answer:
      "Un journal de trading classique, tu l'ouvres après avoir perdu pour analyser ce qui s'est passé. MTC est un compagnon : il est là avant (il te prépare), pendant (il surveille en temps réel) et après (il débrieffe). Les 3 moments sont reliés par l'IA qui connaît ton profil, tes actifs et tes patterns.",
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
    answer: `Le plan Gratuit couvre tout le quotidien : journal illimité, trades illimités, pré-session matin, session live avec trade rapide et suivi prop firm en direct, débrief de session, 1 compte avec ses règles prop firm et sa synchro Tradovate, et l'IA mutualisée (calendrier éco avec analyse IA, news live et contexte marché en temps réel : DXY, taux US, indices). Le plan Premium (${monthly}€/mois ou ${annual}€/an) ajoute l'IA personnelle et la profondeur : IA Insights, Chat coach personnalisé, Weekly Debrief automatique, alertes prop firm en direct (objectif et payout compris, avec le son) et anti-tilt, score trader, analytics avancés et comptes illimités avec leurs règles prop firm.`,
  },
  {
    question: 'Où sont hébergées mes données ?',
    answer:
      "Tes données sont hébergées en France sur des serveurs OVH (Roubaix). Elles ne sont jamais vendues ni partagées avec des tiers. L'IA utilisée est Claude d'Anthropic : tes données ne sont pas utilisées pour entraîner leurs modèles.",
  },
  {
    question: "J'ai un code partenaire, comment ça marche ?",
    answer:
      "Un formateur partenaire peut te donner un code (par exemple dans son lien) : il baisse le prix du Premium selon ses conditions, affichées avant le paiement (prix mensuel ou annuel, à vie ou pendant quelques mois puis prix normal). L'essai d'un mois reste accordé sur le mensuel. Un seul code par personne, réservé à qui n'a jamais été abonné. Il ne se cumule avec aucune autre offre : face à la réduction de parrainage, on applique la plus avantageuse pour toi. Les conditions obtenues ne changent plus ensuite ; la remise s'arrête si ton abonnement se termine.",
  },
];

/**
 * Question « offre fondateur » (#525) : affichée par le navigateur SEULEMENT quand l'offre vend
 * (`open`) ou s'est terminée après ouverture (`ended`), d'après `GET /pricing/founder`. Hors du
 * tableau `FAQ`, donc hors JSON-LD : une donnée structurée ne doit décrire que du contenu visible.
 */
export const FOUNDER_FAQ = {
  question: "C'est quoi l'offre fondateur ?",
  open:
    `Les ${founder.seats} premiers abonnés ont le Premium à ${founder.priceMonthlyEur} €/mois ou ${founder.priceAnnualEur} €/an TTC, au lieu de ${monthly} € et ${annual} €. ` +
    `Mensuel et annuel comptent dans les mêmes ${founder.seats} places. Le prix est bloqué à vie tant que ton abonnement reste actif : les renouvellements gardent ce prix, une hausse future du prix normal ne te touche pas, et tu as tout le Premium, nouveautés comprises. ` +
    `Tu peux passer du mensuel à l'annuel fondateur (ou l'inverse) en gardant ta place et ton numéro. Pas d'essai : le premier paiement est immédiat, le plan Gratuit sert d'essai (l'essai d'un mois reste sur le Premium à ${monthly} €). ` +
    `Satisfait ou remboursé ${FOUNDER_REFUND_DAYS} jours sur le premier paiement : l'abonnement est annulé et le tarif fondateur perdu. En essai Premium ou en mois offert, tu peux basculer : l'essai s'arrête et tu es prélevé tout de suite au tarif fondateur. ` +
    `Si ton abonnement se termine, le tarif est perdu définitivement. Non cumulable avec un code partenaire ni avec le parrainage. L'offre s'arrête quand les ${founder.seats} places sont prises.`,
  ended:
    `L'offre fondateur est clôturée. Les fondateurs gardent leur tarif de ${founder.priceMonthlyEur} €/mois ou ${founder.priceAnnualEur} €/an tant que leur abonnement reste actif, nouveautés Premium comprises. ` +
    `Le Premium reste disponible au prix normal, avec un mois d'essai sur le mensuel.`,
} as const;
