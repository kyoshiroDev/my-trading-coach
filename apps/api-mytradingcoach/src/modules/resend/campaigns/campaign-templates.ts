// ── Templates des campagnes du moteur d'emails ──────────────────────────────
// Chaque template marketing DOIT inclure marketingFooter(unsubUrl) en pied.
// Réutilise les helpers de style partagés (emailWrapper/card/cta/divider/FONT).

import {
  FOUNDER_OFFER,
  FOUNDER_REFUND_DAYS,
  PREMIUM_PRICE_EUR,
  founderSeatsLabel,
} from '@mtc/shared';
import {
  ACCENT,
  FONT,
  RISK_NOTICE,
  card,
  cta,
  divider,
  emailWrapper,
  firstNameOf,
  marketingFooter,
  onboardingLink,
  serviceFooter,
  textLink,
} from '../templates';

import { GREG_FROM, GREG_LOGO_ATTACHMENT, GREG_REPLY_TO, gregLetter } from './greg-letter';

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';
/** Mention de bas des e-mails de l'essai d'inscription (#769) : ton neutre, sans promesse. */
const TRIAL_FOOTER_REASON = 'Tu reçois cet e-mail parce que tu as un compte MyTradingCoach.';

export interface CampaignContent {
  subject: string;
  html: string;
  /** Lettre personnelle (greg-letter) : version texte, expéditeur, réponse, logo intégré. */
  text?: string;
  from?: string;
  replyTo?: string;
  attachments?: { filename: string; content: string; contentId: string }[];
}

export interface CampaignBuildCtx {
  userName: string;
  appUrl: string;
  unsubUrl: string;
  /** Places fondateur restantes, calculées au moment de l'envoi (founder_launch, founder_followup). */
  seatsLeft?: number;
  /** Total des places fondateur (`seatsTotal` de l'API), sinon `FOUNDER_OFFER.seats`. */
  seatsTotal?: number;
  /** Nombre de prop firms du catalogue, lu au moment de l'envoi (prop_firm_rules). */
  propFirmCount?: number;
  /** Bilan des 7 premiers jours depuis l'inscription (first_week_recap), P&L net déjà formaté. */
  firstWeek?: { trades: number; days: number; pnl: string };
  /** Essai d'inscription (#769, B2) : date de fin. */
  trial?: { endsAt: Date };
}

const P = `style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;"`;
const SMALL = `style="${FONT}font-size:13px;color:#8fa3bf;margin:16px 0 0 0;line-height:1.6;"`;
const hello = (userName: string) => {
  const firstName = firstNameOf(userName);
  return firstName ? `Bonjour ${firstName},` : 'Bonjour,';
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Plus aucun essai Stripe promis dans les relances (#769) : tout inscrit depuis l'essai d'inscription a
 * `trialUsed`, le mensuel est facturé dès la souscription.
 */
const NO_TRIAL_LINE = 'Sans engagement, annulable en un clic.';

function heading(eyebrow: string, title: string): string {
  return `<p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">${eyebrow}</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">${title}</h1>`;
}

// ── Suite d'onboarding (oct. 2026) ──────────────────────────────────────────
// connect_tradovate et prop_firm_rules : e-mails de SERVICE (aide à utiliser le compte gratuit,
// intérêt légitime) → aucune mention d'offre payante, pied `serviceFooter`. first_week_recap et
// founder_followup : marketing (consentement), pied `marketingFooter` + mention de risque.
// Un seul bouton par e-mail, liens UTM email / onboarding / <clé>.

export function connectTradovateTemplate({ userName, appUrl, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const link = (path: string) => onboardingLink(appUrl, path, 'connect_tradovate');
  const content =
    card(`
      ${heading('Étape 1', 'Connecte Tradovate en 2 minutes')}
      <p ${P}>${hello(userName)} ton compte est créé. L'étape qui change tout : relier ton compte Tradovate.
        Tes trades arrivent automatiquement, et tu vois pendant ta séance combien il te reste avant ta limite.</p>
      <p ${P}>La connexion passe par la page officielle Tradovate / NinjaTrader, en lecture seule :
        MyTradingCoach ne peut passer aucun ordre.</p>
      ${cta('Connecter mon compte Tradovate →', link('/accounts'))}
      <p ${SMALL}>Pas sur Tradovate ? ${textLink('Importe ton historique en CSV', link('/journal'))}.</p>
    `) + serviceFooter(unsubUrl);

  return {
    subject: 'Connecte Tradovate en 2 minutes',
    html: emailWrapper(content, 'Tes trades arrivent seuls, en lecture seule.', ACCENT.brand, unsubUrl),
  };
}

export function propFirmRulesTemplate({ userName, appUrl, unsubUrl, propFirmCount }: CampaignBuildCtx): CampaignContent {
  const firms = propFirmCount
    ? ` ${plural(propFirmCount, 'prop firm est déjà intégrée', 'prop firms sont déjà intégrées')}.`
    : '';
  const content =
    card(`
      ${heading('Tes règles', 'Ta marge restante, avec les vraies règles de ta firme')}
      <p ${P}>${hello(userName)} chaque firme a ses règles : limite journalière, drawdown suiveur ou en fin de
        journée, objectif.</p>
      <p ${P}>Choisis ta firme et ton plan, et MyTradingCoach calcule ta marge restante avec les règles exactes,
        relevées et datées.${firms}</p>
      ${cta('Choisir ma firme et mon plan →', onboardingLink(appUrl, '/accounts', 'prop_firm_rules'))}
    `) + serviceFooter(unsubUrl);

  return {
    subject: 'Ta marge restante, avec les vraies règles de ta firme',
    html: emailWrapper(content, 'Limite journalière, drawdown, objectif : les règles exactes de ton plan.', ACCENT.brand, unsubUrl),
  };
}

export function firstWeekRecapTemplate({ userName, appUrl, unsubUrl, firstWeek }: CampaignBuildCtx): CampaignContent {
  const week = firstWeek ?? { trades: 0, days: 0, pnl: '0.00' };
  const trades = plural(week.trades, 'trade', 'trades');
  const days = plural(week.days, 'jour de trading', 'jours de trading');
  const content =
    card(`
      ${heading('Ta première semaine', 'Ta première semaine sur MyTradingCoach')}
      <p ${P}>${hello(userName)} cette semaine : ${trades}, ${days}, P&amp;L ${week.pnl}.</p>
      <p ${P}>Avec Premium, tu reçois des alertes avant d'atteindre ta limite, la détection des reprises de
        position après une perte, et un débrief de ta semaine rédigé par le coach IA.</p>
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0;">${NO_TRIAL_LINE}</p>
      ${cta('Voir ce que Premium ajoute →', onboardingLink(appUrl, '/dashboard', 'first_week_recap', { plan: 'premium', cta: 'email' }))}
    `) + RISK_NOTICE + marketingFooter(unsubUrl);

  return {
    subject: 'Ta première semaine sur MyTradingCoach',
    html: emailWrapper(content, `${trades}, ${days} : ton bilan de la semaine.`, ACCENT.brand, unsubUrl),
  };
}

export function founderFollowupTemplate({ userName, appUrl, unsubUrl, seatsLeft, seatsTotal }: CampaignBuildCtx): CampaignContent {
  const total = seatsTotal ?? FOUNDER_OFFER.seats;
  const { priceMonthlyEur: m, priceAnnualEur: y } = FOUNDER_OFFER;
  // Jamais à zéro : la campagne ne part pas quand l'offre ne vend plus (loadContext).
  const seatsText = founderSeatsLabel(seatsLeft ?? total, total) ?? founderSeatsLabel(total, total);
  const content =
    card(`
      ${heading('Offre fondateur', `${m}&nbsp;€/mois tant que ton abonnement reste actif, pour les ${total} premiers`)}
      <p ${P}>${hello(userName)} MyTradingCoach a ouvert une offre pour ses premiers utilisateurs : Premium à
        <strong style="color:#e2eaf5;">${m}&nbsp;€/mois tant que ton abonnement reste actif</strong> (ou ${y}&nbsp;€/an), au lieu de ${PREMIUM_PRICE_EUR.monthly}&nbsp;€/mois.</p>
      <p ${P}><strong style="color:#e2eaf5;">${seatsText}</strong>.</p>
      <p ${P}>Pas d'essai sur cette offre : satisfait ou remboursé pendant ${FOUNDER_REFUND_DAYS} jours.</p>
      ${cta('Devenir fondateur →', onboardingLink(appUrl, '/dashboard', 'founder_followup', { plan: 'founder', cta: 'email' }))}
    `, 'rgba(139,92,246,.4)') + RISK_NOTICE + marketingFooter(unsubUrl);

  return {
    subject: `${m} €/mois tant que ton abonnement reste actif, pour les ${total} premiers`,
    html: emailWrapper(content, `Premium à ${m} €/mois tant que ton abonnement reste actif, au lieu de ${PREMIUM_PRICE_EUR.monthly} €.`, ACCENT.brand, unsubUrl),
  };
}

// ── Premier trade (J+1) ─────────────────────────────────────────────────────

export function firstTradeTemplate({ userName, appUrl, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const content =
    card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Premier pas</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Et si tu enregistrais ton premier trade ? 📈
      </h1>
      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'}, ton compte MyTradingCoach est prêt mais tu n'as pas encore
        noté de trade. C'est en journalisant que tout commence : émotions, setups, résultats.
        En 30 secondes, tu poses la première brique de ta progression.
      </p>
      <div style="margin:16px 0;">
        <div style="margin-bottom:10px;">
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Saisie rapide en quelques secondes</span>
        </div>
        <div style="margin-bottom:10px;">
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Suis ton émotion et ton setup à chaque trade</span>
        </div>
        <div>
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Tes stats se construisent automatiquement</span>
        </div>
      </div>
      ${divider}
      ${cta('Enregistrer mon premier trade →', `${appUrl}/journal`)}
    `) + marketingFooter(unsubUrl);

  return {
    subject: '📈 Enregistre ton premier trade en 30 secondes',
    html: emailWrapper(content, 'Ta progression commence par ton premier trade journalisé.', ACCENT.brand, unsubUrl),
  };
}

// ── Profil stratégie (J+3) ──────────────────────────────────────────────────

export function profileTemplate({ userName, appUrl, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const content =
    card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Profil stratégie</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Personnalise ton coach en 5 minutes 🎯
      </h1>
      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'}, tu n'as pas encore renseigné ton profil stratégie.
        En le complétant, tu permets à MyTradingCoach de vraiment te connaître : ton style,
        ta stratégie, tes sessions et ta fréquence de trades.
      </p>
      ${divider}
      ${cta('Compléter mon profil →', `${appUrl}/profil`)}
    `) + marketingFooter(unsubUrl);

  return {
    subject: '🎯 Personnalise ton coach en 5 minutes',
    html: emailWrapper(content, 'Un profil complet = un coaching vraiment adapté.', ACCENT.brand, unsubUrl),
  };
}

// ── Invitation Discord (J+5) ────────────────────────────────────────────────

export function discordTemplate({ userName, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const content =
    `<div style="background:#0f1824;border:1px solid #5865f2;border-radius:12px;padding:28px 24px;margin-bottom:16px;">
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Communauté</p>
      <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Rejoins les traders sur Discord 💬
      </h1>
      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'}, des traders échangent chaque jour leurs setups et s'entraident.
        C'est gratuit et ça prend 2 minutes.
      </p>
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 16px 0;line-height:1.6;">
        📌 Tape <code style="background:#1e2533;padding:2px 6px;border-radius:4px;color:#00d4aa;font-family:monospace;">/verify</code> dans <strong>#👋-bienvenue</strong> pour obtenir ton rôle.
      </p>
      ${cta('Rejoindre le Discord →', DISCORD_URL, 'secondary')}
    </div>` + marketingFooter(unsubUrl);

  return {
    subject: '💬 Rejoins la communauté Discord MyTradingCoach',
    html: emailWrapper(content, 'Échange tes setups avec des traders comme toi.', ACCENT.discord, unsubUrl),
  };
}

// ── Passe à Premium ─────────────────────────────────────────────────────────

export function premiumTemplate({ userName, appUrl, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const content =
    card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Premium</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Passe au niveau supérieur ⚡
      </h1>
      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'}, tu utilises MyTradingCoach activement. Va plus loin avec
        les alertes avant ta limite de perte, l'anti-tilt en direct, le débrief de ta semaine par le
        coach IA et les analyses avancées.
      </p>
      <p style="${FONT}font-size:13px;color:#6b8299;margin:0 0 16px 0;">
        ${NO_TRIAL_LINE}
      </p>
      ${divider}
      ${cta('Découvrir Premium →', `${appUrl}/dashboard?plan=premium&cta=email`)}
    `, 'rgba(99,92,246,.4)') + marketingFooter(unsubUrl);

  return {
    subject: '⚡ Passe à Premium',
    html: emailWrapper(content, 'Alertes avant ta limite, anti-tilt, débrief IA de ta semaine.', ACCENT.brand, unsubUrl),
  };
}

// ── Réengagement (sans trade depuis 7 j) ────────────────────────────────────

export function reengagementTemplate({ userName, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const content =
    card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">On t'a manqué</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Un retour sur MyTradingCoach ? 📖
      </h1>
      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'}, ça fait un moment qu'on ne t'a pas vu journaliser.
        Qu'est-ce qui t'a manqué ou bloqué ? Pas eu le temps, un détail à améliorer, un bug ?
      </p>
      <p style="${FONT}font-size:13px;color:#6b8299;margin:0 0 8px 0;line-height:1.7;">
        Réponds-moi en une ligne, c'est super précieux pour améliorer l'app 🙏
      </p>
    `) + marketingFooter(unsubUrl);

  return {
    subject: '📖 Un retour sur MyTradingCoach ?',
    html: emailWrapper(content, 'Ton avis nous aide à améliorer l\'app.', ACCENT.brand, unsubUrl),
  };
}

// ── Annonce / Nouveauté (contenu fourni par l'admin) ────────────────────────

export function announcementTemplate(
  ctx: CampaignBuildCtx,
  override?: { subject?: string; bodyHtml?: string },
): CampaignContent {
  const { userName, appUrl, unsubUrl } = ctx;
  const body =
    override?.bodyHtml ??
    `<p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">Découvre les dernières nouveautés de MyTradingCoach.</p>`;
  const content =
    card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Nouveauté</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        ${override?.subject || '📣 Nouveauté MyTradingCoach'}
      </h1>
      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;">Bonjour ${userName || 'Trader'},</p>
      ${body}
      ${divider}
      ${cta('Découvrir →', appUrl)}
    `) + marketingFooter(unsubUrl);

  return {
    subject: override?.subject?.trim() || '📣 Nouveauté MyTradingCoach',
    html: emailWrapper(content, '', ACCENT.brand, unsubUrl),
  };
}

// ── Lancement de l'offre fondateur (#525) ──────────────────────────────────────
// Lettre de Greg (version validée le 2026-10-08). Les destinataires ont déjà un compte : le lien va
// droit dans l'app, qui garde l'intention (`plan=founder`, `cta=email`) pendant la connexion puis
// ouvre la modale fondateur, d'où l'on passe au paiement.

/** Lien de la campagne : app (connexion si besoin) + intention fondateur + UTM de la campagne. */
export const founderLaunchUrl = (appUrl: string) =>
  `${appUrl.replace(/\/+$/, '')}/dashboard?plan=founder&cta=email&utm_source=email&utm_medium=campaign&utm_campaign=fondateur`;

export function founderLaunchTemplate({ userName, appUrl, unsubUrl, seatsLeft }: CampaignBuildCtx): CampaignContent {
  const seats = seatsLeft ?? FOUNDER_OFFER.seats;
  // {prénom} : `name` est libre (« Greg Tahir ») → premier mot ; vide → « Salut, ».
  const firstName = userName.trim().split(/\s+/)[0] ?? '';
  const hello = firstName ? `Salut ${firstName},` : 'Salut,';
  const { seats: total, priceMonthlyEur: m, priceAnnualEur: y } = FOUNDER_OFFER;
  const { monthly: normalM, annual: normalY } = PREMIUM_PRICE_EUR;
  const saved = (normalM - m) * 12;
  const url = founderLaunchUrl(appUrl);
  // Compteur : libellé partagé (« 200 places disponibles » tant qu'aucune n'est prise). Jamais à zéro :
  // la campagne est refusée quand l'offre ne vend plus.
  const seatsText = founderSeatsLabel(seats, total) ?? founderSeatsLabel(total, total);

  const hook = "Le plus dur en trading, ce n'est pas de trouver un setup : c'est de ne pas tout perdre sur une mauvaise séance. C'est pour ça que j'ai construit MyTradingCoach.";
  const intro = `Aujourd'hui, j'ouvre l'offre fondateur, réservée aux ${total} premiers : ceux qui construisent l'outil avec moi.`;
  const concrete = 'Concrètement, Premium te prévient avant que tu atteignes ta perte journalière max de prop firm, et te signale en direct quand tu passes en revenge trading ou en surtrading. Tu as aussi le coach IA, le debrief de la semaine et les comptes illimités.';
  const free = 'Si le gratuit te suffit, aucun souci : il reste gratuit, sans limite de trades.';
  const ps = 'Le prix fondateur ne bouge plus tant que tu restes abonné. Et si ça ne te convient pas, je te rembourse ton premier paiement sous 14 jours, sans discussion.';

  const p = 'style="margin:0 0 16px;line-height:1.55"';
  const link = (label: string) =>
    `<a href="${url}" style="color:#1a73e8;font-weight:600;text-decoration:none">${label}</a>`;
  const bodyHtml = `<p ${p}>${escapeHtml(hello)}</p>
<p ${p}>${hook}</p>
<p ${p}>${intro}</p>
<ul style="margin:0 0 16px;padding-left:22px;line-height:1.55">
  <li style="margin-bottom:6px">Premium à <b>${m} €/mois</b> au lieu de ${normalM} € (ou <b>${y} €/an</b> au lieu de ${normalY} €) : <b>jusqu'à ${saved} € économisés par an</b></li>
  <li style="margin-bottom:6px"><b>Prix bloqué à vie</b>, tant que ton abonnement reste actif</li>
  <li style="margin-bottom:6px"><b>Satisfait ou remboursé 14 jours</b> : tu ne prends aucun risque</li>
</ul>
<p ${p}>${concrete}</p>
<p ${p}><b>${seatsText}</b>. Quand elles sont parties, c'est ${normalM} €.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr><td style="border-radius:8px;background:#3b82f6">
  <a href="${url}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">Je prends ma place fondateur</a>
</td></tr></table>
<p ${p}>${free}</p>`;
  const postscript = `<p style="margin:18px 0 0;line-height:1.55"><b>P.S.</b> ${ps} → ${link('Devenir fondateur')}</p>`;
  const bodyText = [
    hello,
    hook,
    intro,
    [
      `- Premium à ${m} €/mois au lieu de ${normalM} € (ou ${y} €/an au lieu de ${normalY} €) : jusqu'à ${saved} € économisés par an`,
      '- Prix bloqué à vie, tant que ton abonnement reste actif',
      '- Satisfait ou remboursé 14 jours : tu ne prends aucun risque',
    ].join('\n'),
    concrete,
    `${seatsText}. Quand elles sont parties, c'est ${normalM} €.`,
    `Je prends ma place fondateur : ${url}`,
    free,
  ].join('\n\n');

  const letter = gregLetter({
    preheader: "L'offre fondateur MyTradingCoach est ouverte. Premier arrivé, premier servi.",
    bodyHtml,
    bodyText,
    postscriptHtml: postscript,
    postscriptText: `P.S. ${ps} → ${url}`,
    legal: 'Le trading comporte un risque de perte en capital.',
    unsubUrl,
  });
  return {
    subject: `${total} places à ${m} €/mois, prix bloqué tant que tu restes abonné`,
    html: letter.html,
    text: letter.text,
    from: GREG_FROM,
    replyTo: GREG_REPLY_TO,
    attachments: [GREG_LOGO_ATTACHMENT],
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ── Essai Premium d'inscription (#769, B2) : e-mails de service, ton neutre ─────────────────

const longDateFr = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });

export function trialEndingTemplate({ userName, appUrl, unsubUrl, trial }: CampaignBuildCtx): CampaignContent {
  // Service, ton neutre (décision du 27/10) : la date de fin et ce qui change, aucune offre ni urgence.
  const end = longDateFr(trial?.endsAt ?? new Date());
  const content =
    card(`
      ${heading('Ton essai', `Ton Premium offert se termine le ${end}`)}
      <p ${P}>${hello(userName)} ton Premium offert se termine le ${end}. Ensuite, ton compte repasse en
        gratuit tout seul&nbsp;: rien n'est supprimé et rien n'est prélevé.</p>
      <p ${P}>Ce qui change en gratuit&nbsp;: les alertes avant ta limite, l'anti-tilt en direct et le débrief
        de ta semaine s'arrêtent. Tu gardes ton journal, tout ton historique, la synchro Tradovate et un
        compte avec les règles de sa prop firm suivi en direct. Si tu as plusieurs comptes, tu choisis
        celui que tu gardes&nbsp;; les autres restent visibles avec tout leur historique.</p>
      ${cta('Voir mon abonnement', onboardingLink(appUrl, '/profil', 'trial_ending', { tab: 'params' }))}
    `) + serviceFooter(unsubUrl, TRIAL_FOOTER_REASON);

  return {
    subject: `Ton Premium offert se termine le ${end}`,
    html: emailWrapper(content, `Fin le ${end}&nbsp;: rien n'est supprimé ni prélevé.`, ACCENT.brand, unsubUrl),
  };
}

export function trialEndedTemplate({ userName, appUrl, unsubUrl }: CampaignBuildCtx): CampaignContent {
  const content =
    card(`
      ${heading('Ton essai', 'Ton Premium offert est terminé')}
      <p ${P}>${hello(userName)} ton compte est repassé en gratuit. Tes trades, tes comptes et ton historique
        restent là&nbsp;: rien n'est supprimé.</p>
      <p ${P}>En gratuit, tu gardes la synchro Tradovate, un compte avec les règles de sa prop firm suivi en
        direct, ton journal et la préparation de tes séances.</p>
      ${cta('Voir les offres Premium →', onboardingLink(appUrl, '/dashboard', 'trial_ended', { plan: 'premium', cta: 'email' }))}
    `) + serviceFooter(unsubUrl, TRIAL_FOOTER_REASON);

  return {
    subject: 'Ton Premium offert est terminé',
    html: emailWrapper(content, 'Ton compte est repassé en gratuit, rien n’est supprimé.', ACCENT.brand, unsubUrl),
  };
}

