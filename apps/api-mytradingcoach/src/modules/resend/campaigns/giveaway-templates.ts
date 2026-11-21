// ── Tirage au sort mensuel (PROMPT-tirage-mensuel) ──────────────────────────
// Gagnant (transactionnel), fin du Premium gagné dans 3 jours (service) et annonce à l'activation
// (marketing). Tutoiement, aucune promesse de gain de trading, aucun prix.

import {
  GIVEAWAY_FREE_PRIZE_MONTHS,
  GIVEAWAY_MIN_TRADES,
  GIVEAWAY_PREMIUM_MIN_PAID_MONTHS,
  GIVEAWAY_PREMIUM_PRIZE_MONTHS,
  GiveawayPool,
  giveawayDrawDayLabel,
} from '@mtc/shared';
import { ACCENT, FONT, RISK_NOTICE, card, cta, emailWrapper, escapeHtml, firstNameOf, marketingFooter, onboardingLink, serviceFooter } from '../templates';
import type { CampaignBuildCtx, CampaignContent } from './campaign-templates';

/**
 * Expéditeur des e-mails du tirage vus par les traders (décision du relecteur du 21/11 : contact@,
 * adresse publique ; les réponses y arrivent). L'alerte à l'admin reste sur `sendAdminAlert`.
 */
export const GIVEAWAY_FROM = 'MyTradingCoach <contact@mytradingcoach.app>';
export const GIVEAWAY_REPLY_TO = 'contact@mytradingcoach.app';

/** Page « Concours du mois » et page gagnant de l'app (lot B). */
export const GIVEAWAY_APP_PATH = '/concours';
export const GIVEAWAY_WINNER_PATH = '/concours/gagnant';

const P = `style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;"`;
const longDateFr = (d: Date) =>
  d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const months = (n: number) => `${n}\u00a0mois`;
const hello = (userName: string) => {
  const firstName = firstNameOf(userName);
  return firstName ? `Bonjour ${escapeHtml(firstName)},` : 'Bonjour,';
};

function heading(eyebrow: string, title: string): string {
  return `<p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">${eyebrow}</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">${title}</h1>`;
}

/** Au gagnant : ce qu'il a gagné, la date de fin, le lien vers sa page gagnant. */
export function giveawayWinnerTemplate(params: {
  userName: string;
  appUrl: string;
  pool: GiveawayPool;
  prizeMonths: number;
  endsAt: Date;
  /** Lot Premium : intervalle de l'abonnement (avoir déduit des prochains prélèvements ou du prochain renouvellement). */
  interval?: 'month' | 'year' | null;
}): CampaignContent {
  const prize = months(params.prizeMonths);
  const end = longDateFr(params.endsAt);
  const free = params.pool === GiveawayPool.FREE;
  const deduction = params.interval === 'year' ? 'de ton prochain renouvellement annuel' : 'de tes prochains prélèvements';
  const what =
    free
      ? `Tu as gagné <strong>${prize} de Premium</strong>, déjà activé sur ton compte, sans carte. Il court jusqu'au ${end}, puis ton compte repasse en gratuit tout seul&nbsp;: rien n'est prélevé.`
      : `Tu as gagné <strong>${prize} offerts</strong> sur ton abonnement Premium. Le montant est déjà crédité sur ton compte de facturation et sera déduit ${deduction}. Ton abonnement continue ensuite normalement.`;
  const content =
    card(`
      ${heading('Tirage du mois', 'Tu as gagné le tirage du mois')}
      <p ${P}>${hello(params.userName)} tu as été tiré au sort parmi les traders qui ont enregistré leurs trades le mois dernier.</p>
      <p ${P}>${what}</p>
      <p ${P}>Sur ta page gagnant, tu choisis si ton nom apparaît dans la liste des gagnants (pseudo ou prénom avec initiale) et tu peux laisser un petit message. Sans réponse de ta part, rien n'est affiché.</p>
      ${cta('Voir ma page gagnant', onboardingLink(params.appUrl, GIVEAWAY_WINNER_PATH, 'giveaway_winner'))}
    `) + RISK_NOTICE;
  return {
    subject: free
      ? `Tu as gagné le tirage du mois\u00a0: ${prize} de Premium offert`
      : `Tu as gagné le tirage du mois\u00a0: ${prize} offerts`,
    // Lot Premium = avoir : pas de date de fin, il est déduit des prochaines échéances.
    html: emailWrapper(
      content,
      free ? `${prize} de Premium offert, jusqu'au ${end}.` : `${prize} offerts, déduits ${deduction}.`,
      ACCENT.brand,
    ),
    from: GIVEAWAY_FROM,
    replyTo: GIVEAWAY_REPLY_TO,
  };
}

/** Lot gratuit : fin du Premium gagné dans 3 jours (campagne `giveaway_ending`). */
export function giveawayEndingTemplate({ userName, appUrl, unsubUrl, giveaway }: CampaignBuildCtx): CampaignContent {
  const end = longDateFr(giveaway?.endsAt ?? new Date());
  const content =
    card(`
      ${heading('Ton lot', `Ton Premium gagné se termine le ${end}`)}
      <p ${P}>${hello(userName)} le Premium que tu as gagné au tirage se termine le ${end}. Ensuite, ton compte repasse en
        gratuit tout seul&nbsp;: rien n'est supprimé et rien n'est prélevé.</p>
      <p ${P}>Tu veux garder le Premium&nbsp;? Tu peux t'abonner depuis ton profil, quand tu veux. Sinon, tu gardes ton
        journal, tout ton historique et la synchro Tradovate en gratuit.</p>
      ${cta('Garder le Premium', onboardingLink(appUrl, '/profil', 'giveaway_ending', { tab: 'params' }))}
    `) + serviceFooter(unsubUrl, 'Tu reçois cet e-mail parce que tu as gagné le tirage du mois sur MyTradingCoach.');
  return {
    subject: `Ton Premium gagné se termine le ${end}`,
    html: emailWrapper(content, `Fin le ${end}\u00a0: rien n'est supprimé ni prélevé.`, ACCENT.brand, unsubUrl),
    from: GIVEAWAY_FROM,
    replyTo: GIVEAWAY_REPLY_TO,
  };
}

/** Annonce à l'activation d'un tirage : aux gratuits (tirage gratuit) ou aux Premium (tirage Premium). */
export function giveawayAnnounceTemplate(params: {
  userName: string;
  appUrl: string;
  unsubUrl: string;
  pool: GiveawayPool;
  nextDrawAt: Date;
}): CampaignContent {
  const next = longDateFr(params.nextDrawAt);
  const day = giveawayDrawDayLabel();
  const free = params.pool === GiveawayPool.FREE;
  const intro = free
    ? `chaque mois, un compte gratuit est tiré au sort. À gagner&nbsp;: <strong>${months(GIVEAWAY_FREE_PRIZE_MONTHS)} de Premium offert, sans carte</strong>.`
    : `chaque mois, un abonné Premium est tiré au sort. À gagner&nbsp;: <strong>${months(GIVEAWAY_PREMIUM_PRIZE_MONTHS)} d'abonnement offerts</strong>.`;
  const how = free
    ? `Pour participer, enregistre au moins ${GIVEAWAY_MIN_TRADES} trades dans le mois&nbsp;: le tirage a lieu le ${day} du mois suivant. Le prochain, c'est le ${next}. Toutes les conditions sont dans l'app.`
    : `Pour participer&nbsp;: être abonné depuis au moins ${months(GIVEAWAY_PREMIUM_MIN_PAID_MONTHS)} et enregistrer au moins ${GIVEAWAY_MIN_TRADES} trades dans le mois. Le tirage a lieu le ${day} du mois suivant&nbsp;; le prochain, c'est le ${next}. Toutes les conditions sont dans l'app.`;
  const content =
    card(`
      ${heading('Nouveau', 'Un tirage au sort chaque mois')}
      <p ${P}>${hello(params.userName)} ${intro}</p>
      <p ${P}>${how}</p>
      ${cta('Voir le concours du mois', onboardingLink(params.appUrl, GIVEAWAY_APP_PATH, 'giveaway_announce'))}
    `) + RISK_NOTICE + marketingFooter(params.unsubUrl);
  return {
    subject: 'Nouveau\u00a0: un tirage au sort chaque mois',
    html: emailWrapper(content, `Prochain tirage le ${next}.`, ACCENT.brand, params.unsubUrl),
    from: GIVEAWAY_FROM,
    replyTo: GIVEAWAY_REPLY_TO,
  };
}
