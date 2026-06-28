// ── Templates des campagnes du moteur d'emails ──────────────────────────────
// Chaque template marketing DOIT inclure marketingFooter(unsubUrl) en pied.
// Réutilise les helpers de style partagés (emailWrapper/card/cta/divider/FONT).

import {
  FONT,
  card,
  cta,
  divider,
  emailWrapper,
  marketingFooter,
} from '../templates';

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';

export interface CampaignContent {
  subject: string;
  html: string;
}

export interface CampaignBuildCtx {
  userName: string;
  appUrl: string;
  unsubUrl: string;
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
    html: emailWrapper(content, 'Échange tes setups avec des traders comme toi.'),
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
        7 jours gratuits · Sans CB · Annulable à tout moment.
      </p>
      ${divider}
      ${cta('Essayer Premium →', `${appUrl}/parametres?upgrade=1`)}
    `, 'rgba(99,92,246,.4)') + marketingFooter(unsubUrl);

  return {
    subject: '⚡ Passe à Premium — 7 jours gratuits',
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
