// ── Templates des campagnes du moteur d'emails ──────────────────────────────
// Chaque template marketing DOIT inclure marketingFooter(unsubUrl) en pied.
// Réutilise les helpers de style partagés (emailWrapper/card/cta/divider/FONT).

import { FOUNDER_OFFER, PREMIUM_PRICE_EUR } from '@mtc/shared';
import {
  ACCENT,
  FONT,
  card,
  cta,
  divider,
  emailWrapper,
  marketingFooter,
} from '../templates';

import { GREG_FROM, GREG_LOGO_ATTACHMENT, GREG_REPLY_TO, gregLetter } from './greg-letter';

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';

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
  /** Places fondateur restantes, calculées au moment de l'envoi (campagne founder_launch). */
  seatsLeft?: number;
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
      ${cta('Enregistrer mon premier trade →', `${appUrl}/trades`)}
    `) + marketingFooter(unsubUrl);

  return {
    subject: '📈 Enregistre ton premier trade en 30 secondes',
    html: emailWrapper(content, 'Ta progression commence par ton premier trade journalisé.'),
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
        ta stratégie (ICT, SMC, Price Action…), tes sessions et ta fréquence de trades.
      </p>
      ${divider}
      ${cta('Compléter mon profil →', `${appUrl}/parametres`)}
    `) + marketingFooter(unsubUrl);

  return {
    subject: '🎯 Personnalise ton coach en 5 minutes',
    html: emailWrapper(content, 'Un profil complet = un coaching vraiment adapté.'),
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
        Bonjour ${userName || 'Trader'}, des traders ICT, SMC et Price Action échangent chaque jour
        leurs setups et s'entraident. C'est gratuit et ça prend 2 minutes.
      </p>
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 16px 0;line-height:1.6;">
        📌 Tape <code style="background:#1e2533;padding:2px 6px;border-radius:4px;color:#00d4aa;font-family:monospace;">/verify</code> dans <strong>#👋-bienvenue</strong> pour obtenir ton rôle.
      </p>
      ${cta('Rejoindre le Discord →', DISCORD_URL, 'secondary')}
    </div>` + marketingFooter(unsubUrl);

  return {
    subject: '💬 Rejoins la communauté Discord MyTradingCoach',
    html: emailWrapper(content, 'Échange tes setups avec des traders comme toi.', ACCENT.discord),
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
        le Coach IA, le Weekly Debrief automatique, les analytics avancés et l'import CSV.
      </p>
      <p style="${FONT}font-size:13px;color:#6b8299;margin:0 0 16px 0;">
        1 mois offert · Carte requise · Annulable en un clic.
      </p>
      ${divider}
      ${cta('Essayer Premium →', `${appUrl}/parametres?upgrade=1`)}
    `, 'rgba(99,92,246,.4)') + marketingFooter(unsubUrl);

  return {
    subject: '⚡ Passe à Premium · 1 mois offert',
    html: emailWrapper(content, 'Coach IA, Weekly Debrief, analytics avancés.'),
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
    html: emailWrapper(content, 'Ton avis nous aide à améliorer l\'app.'),
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
    html: emailWrapper(content),
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
<p ${p}>Il reste <b>${seats} places sur ${total}</b>. Quand elles sont parties, c'est ${normalM} €.</p>
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
    `Il reste ${seats} places sur ${total}. Quand elles sont parties, c'est ${normalM} €.`,
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
    subject: `${total} places à ${m} €/mois, à vie`,
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
