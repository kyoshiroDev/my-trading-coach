import { FOUNDER_OFFER, FOUNDER_REFUND_DAYS, PREMIUM_PRICE_EUR, PREMIUM_SIGNUP_TRIAL_DAYS } from '@mtc/shared';

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
    question: 'Quelle est la différence avec un journal de trading classique\u00a0?',
    answer:
      "Un journal de trading classique, tu l'ouvres après avoir perdu pour analyser ce qui s'est passé. MTC est un compagnon\u00a0: il est là avant (il te prépare), pendant (il suit ta séance en direct quand il est ouvert) et après (il débriefe). Les 3 moments sont reliés par l'IA qui connaît ton profil, tes actifs et tes patterns.",
  },
  {
    question: 'Quels marchés sont supportés\u00a0?',
    answer:
      'Tous les marchés\u00a0: Futures CME (NQ, ES, MES, MNQ, 6E, 6B, Gold, Crude Oil\u00a0: P&L en ticks avec multiplicateurs officiels), Crypto spot et levier (Binance, Bybit, Coinbase…), Forex (toutes paires), Indices CFD, Actions. Un seul journal pour tout, multi-marché natif.',
  },
  {
    question: 'Comment fonctionne le calendrier économique IA\u00a0?',
    answer:
      "Chaque matin, MTC récupère les événements économiques du jour (NFP, PMI, décisions Fed, etc.) et les filtre pour tes actifs spécifiques. Tu vois uniquement ce qui te concerne\u00a0: NQ, BTC/USDT, EUR/USD. Quand un résultat tombe en cours de session, l'IA lit tout de suite le chiffre publié et le situe pour tes actifs (au-dessus, en ligne ou en dessous de la prévision). C'est une lecture de l'annonce, à titre informatif\u00a0: ni une prévision, ni un conseil.",
  },
  {
    question: 'Puis-je importer mon historique de trades\u00a0?',
    answer:
      "Oui. Si tu trades sur Tradovate, tu peux connecter ton compte directement\u00a0: tes trades et leurs frais se synchronisent automatiquement, en lecture seule (MyTradingCoach ne voit jamais ton mot de passe et ne peut passer aucun ordre). L'import CSV reconnaît automatiquement les exports Tradovate et ceux de plusieurs autres courtiers et plateformes, en gratuit. Pour un autre broker, l'import IA lit ton fichier tel quel et structure ton historique\u00a0: il est réservé au Premium.",
  },
  {
    question: 'À quelle fréquence mes trades sont-ils synchronisés\u00a0?',
    answer:
      "En direct quand MyTradingCoach est ouvert. Application fermée, relevé automatique toutes les 15 minutes environ.",
  },
  {
    question: 'Quels comptes sont compatibles\u00a0?',
    answer:
      "MyTradingCoach se connecte à ton compte Tradovate en lecture seule. Ça fonctionne avec tes comptes d'évaluation et financés des prop firms qui tournent sur Tradovate, et avec tes comptes simulés ou réels.",
  },
  {
    question: "Comment fonctionne l'essai Premium\u00a0?",
    answer:
      `À l'inscription, tu as ${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts, sans carte bancaire. À la fin, ton compte repasse automatiquement en Gratuit, sans rien perdre et sans aucun prélèvement. Si tu veux continuer en Premium, tu choisis une offre\u00a0: l'abonnement démarre alors, sans nouvel essai.`,
  },
  {
    question: 'Quelle est la différence entre Gratuit et Premium\u00a0?',
    answer: `Le plan Gratuit couvre tout le quotidien\u00a0: journal illimité, trades illimités, pré-session matin, session live avec trade rapide et suivi prop firm en direct quand MTC est ouvert, débrief de session, 1 compte avec ses règles prop firm et sa synchro Tradovate, et l'IA mutualisée (calendrier éco avec analyse IA, news live et contexte marché en temps réel\u00a0: DXY, taux US, indices). Le plan Premium (${monthly}€/mois ou ${annual}€/an) ajoute l'IA personnelle et la profondeur\u00a0: IA Insights, Chat coach personnalisé, Débrief hebdo automatique, alertes prop firm en direct (objectif et payout compris, avec le son) et anti-tilt, score trader, analytics avancés et comptes illimités avec leurs règles prop firm.`,
  },
  {
    question: 'Où sont hébergées mes données\u00a0?',
    answer:
      "Ta base de données est hébergée en France chez OVH. Tes données ne sont jamais vendues. Seuls nos prestataires techniques en reçoivent ce qu'il faut pour faire tourner le service\u00a0: paiement, envoi d'e-mails, analyse par IA, surveillance des erreurs et sauvegardes chiffrées. La liste complète est dans la politique de confidentialité. Pour l'IA, on utilise l'API de Claude (Anthropic)\u00a0: selon la fonction, elle reçoit tes trades, tes notes et le nom de tes comptes, jamais ton nom ni ton e-mail, et ses conditions commerciales lui interdisent d'entraîner ses modèles sur ces données.",
  },
  {
    question: "J'ai un code partenaire, comment ça marche\u00a0?",
    answer:
      "Un formateur partenaire peut te donner un code (par exemple dans son lien)\u00a0: il baisse le prix du Premium selon ses conditions, affichées avant le paiement (prix mensuel ou annuel, à vie ou pendant quelques mois puis prix normal). Un seul code par personne, réservé à qui n'a jamais été abonné. Il ne se cumule avec aucune autre offre\u00a0: face à la réduction de parrainage, on applique la plus avantageuse pour toi. Les conditions obtenues ne changent plus ensuite\u00a0; la remise s'arrête si ton abonnement se termine.",
  },
];

/**
 * Question « offre fondateur » (#525) : affichée par le navigateur SEULEMENT quand l'offre vend
 * (`open`) ou s'est terminée après ouverture (`ended`), d'après `GET /pricing/founder`. Hors du
 * tableau `FAQ`, donc hors JSON-LD : une donnée structurée ne doit décrire que du contenu visible.
 */
export const FOUNDER_FAQ = {
  question: "C'est quoi l'offre fondateur\u00a0?",
  open:
    `Les ${founder.seats} premiers abonnés ont le Premium à ${founder.priceMonthlyEur} €/mois ou ${founder.priceAnnualEur} €/an TTC, au lieu de ${monthly} € et ${annual} €. ` +
    `Mensuel et annuel comptent dans les mêmes ${founder.seats} places. Le prix est bloqué à vie tant que ton abonnement reste actif\u00a0: les renouvellements gardent ce prix, une hausse future du prix normal ne te touche pas, et tu as tout le Premium, nouveautés comprises. ` +
    `Tu peux passer du mensuel à l'annuel fondateur (ou l'inverse) en gardant ta place et ton numéro. Pas d'essai\u00a0: le premier paiement est immédiat. Pendant tes ${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts à l'inscription, tu peux réserver ta place\u00a0: elle est comptée tout de suite, et tu n'es prélevé qu'à la fin de ton essai (s'il reste plus de 2 jours). ` +
    `Satisfait ou remboursé ${FOUNDER_REFUND_DAYS} jours à partir du premier paiement\u00a0: l'abonnement est annulé et le tarif fondateur perdu. ` +
    `Si ton abonnement se termine, le tarif est perdu définitivement. Non cumulable avec un code partenaire ni avec le parrainage. L'offre s'arrête quand les ${founder.seats} places sont prises.`,
  ended:
    `L'offre fondateur est clôturée. Les fondateurs gardent leur tarif de ${founder.priceMonthlyEur} €/mois ou ${founder.priceAnnualEur} €/an tant que leur abonnement reste actif, nouveautés Premium comprises. ` +
    `Le Premium reste disponible au prix normal. Tout nouvel inscrit a ${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts, sans carte.`,
} as const;
