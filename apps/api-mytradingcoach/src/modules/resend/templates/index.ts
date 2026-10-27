// ── Templates emails MyTradingCoach ─────────────────────────────────────────
// Templates HTML inline : pas de dépendance externe pour le rendu
import { FOUNDER_REFUND_DAYS, PLAN_BENEFITS, PREMIUM_SIGNUP_TRIAL_DAYS, formatMoney } from '@mtc/shared';

// ── Base système ──────────────────────────────────────────────────────────────

export const FONT = `font-family: 'Inter', -apple-system, Arial, sans-serif;`;
const MONO = `font-family: 'JetBrains Mono', 'Courier New', monospace;`;
const BRAND_FONT = `font-family: 'Space Grotesk', 'Inter', -apple-system, Arial, sans-serif;`;

// Pied de page marketing : mention RGPD + lien de désinscription obligatoire.
// Réutilisé par les templates de campagnes marketing (campaign-registry).
export function marketingFooter(unsubUrl: string): string {
  return `<p style="${FONT}font-size:12px;color:#9db4ce;line-height:1.6;margin:18px 0 0 0;text-align:center;">
    Tu reçois cet email parce que tu as un compte MyTradingCoach.
    <a href="${unsubUrl}" style="color:#9db4ce;text-decoration:underline;">Me désinscrire des emails</a>.
  </p>`;
}

// Pied des e-mails de service (aide à la prise en main, intérêt légitime) : lien qui n'arrête QUE
// ces conseils (`scope=service`, construit par EmailDispatchService).
export function serviceFooter(unsubUrl: string): string {
  return `<p style="${FONT}font-size:12px;color:#9db4ce;line-height:1.6;margin:18px 0 0 0;text-align:center;">
    Tu reçois cet email pour t'aider à démarrer avec ton compte MyTradingCoach.
    <a href="${unsubUrl}" style="color:#9db4ce;text-decoration:underline;">Ne plus recevoir ces conseils</a>.
  </p>`;
}

// Mention légale des e-mails qui parlent d'une offre payante.
export const RISK_NOTICE = `<p style="${FONT}font-size:12px;color:#8fa3bf;font-style:italic;line-height:1.6;margin:16px 0 0 0;text-align:center;">Le trading comporte un risque de perte en capital.</p>`;

// Barres d'accent pleine largeur (haut de l'email) : la couleur annonce la nature du message.
export const ACCENT = {
  brand: 'linear-gradient(90deg,#3b82f6,#8b5cf6)',
  alert: 'linear-gradient(90deg,#ef4444,#f59e0b)', // sécurité, paiement échoué
  success: 'linear-gradient(90deg,#10b981,#3b82f6)', // paiement reçu, recap positif
  discord: 'linear-gradient(90deg,#5865f2,#8b5cf6)',
} as const;

// Première couleur du dégradé : repli pour les clients mail qui ignorent linear-gradient (Outlook).
function gradientFallback(gradient: string): string {
  return gradient.match(/#[0-9a-f]{3,8}/i)?.[0] ?? '#3b82f6';
}

// Logo : PNG hébergé par l'app (apps/app-mytradingcoach/public/logo-email.png, 80 px affiché en
// 40 px pour rester net sur écran Retina). Le SVG inline était retiré par Gmail et Outlook.
// Servi par l'environnement de l'API (FRONTEND_URL) : dev → dev.app, prod → app.
function logo(): string {
  const src = `${process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app'}/logo-email.png`;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" align="center">
  <tr>
    <td width="40" valign="middle" style="width:40px;">
      <img src="${src}" width="40" height="40" alt="MyTradingCoach" style="display:block;width:40px;height:40px;border:0;outline:none;text-decoration:none;border-radius:10px;">
    </td>
    <td valign="middle" style="padding-left:12px;${BRAND_FONT}font-size:19px;font-weight:700;letter-spacing:-.3px;color:#f4f7fb;white-space:nowrap;">
      MyTrading<span style="color:#60a5fa;">Coach</span>
    </td>
  </tr>
</table>`;
}

/**
 * `unsubUrl` : lien de désinscription en un clic de l'e-mail (campagnes marketing / service). Sans lui
 * (e-mails liés au compte), le pied mène aux préférences e-mail du profil.
 */
export function emailWrapper(
  content: string,
  preheader = '',
  accentGradient: string = ACCENT.brand,
  unsubUrl?: string,
): string {
  const appUrl = process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app';
  const footerLink = unsubUrl
    ? `<a href="${unsubUrl}" style="color:#9db4ce;text-decoration:none;">Se désabonner</a>`
    : `<a href="${appUrl}/profil?tab=params" style="color:#9db4ce;text-decoration:none;">Gérer mes e-mails</a>`;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <!-- Thème sombre assumé : empêche Apple Mail / iOS d'imposer un fond clair -->
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <style>:root { color-scheme: dark; supported-color-schemes: dark; } body { margin:0; padding:0; background:#080c14; }
    /* Écran étroit : les stat-cells passent en pile verticale (3 colonnes illisibles sous ~480px) */
    @media only screen and (max-width: 480px) {
      .stat-cell-td { display:block !important; width:100% !important; box-sizing:border-box; margin-bottom:8px !important; }
      .stat-gap { display:none !important; }
    }
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
  <title>MyTradingCoach</title>
</head>
<body bgcolor="#080c14" style="margin:0;padding:0;background:#080c14;${FONT}">
  <!-- Gmail retire le style du <body> : le fond sombre est porté par ce conteneur et la table (bgcolor) -->
  <div style="background:#080c14;background-color:#080c14;margin:0;padding:0;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#080c14" style="background:#080c14;background-color:#080c14;min-height:100vh;">
    <!-- BARRE D'ACCENT -->
    <tr>
      <td height="4" style="height:4px;line-height:4px;font-size:0;background:${gradientFallback(accentGradient)};background-image:${accentGradient};">&nbsp;</td>
    </tr>
    <tr>
      <td align="center" valign="top" style="padding:28px 16px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;">

          <!-- HEADER -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              ${logo()}
            </td>
          </tr>

          <!-- CONTENU -->
          <tr>
            <td>
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding-top:32px;border-top:1px solid rgba(99,155,255,.08);margin-top:32px;text-align:center;">
              <p style="${MONO}font-size:11px;color:#9db4ce;line-height:1.8;margin:0;text-align:center;">
                MyTradingCoach<br>
                Fait en France 🇫🇷<br>
                SIRET 512 926 460 00027<br>
                <a href="https://www.mytradingcoach.app" style="color:#9db4ce;text-decoration:none;">mytradingcoach.app</a><br>
                ${footerLink}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
  </div>
</body>
</html>`;
}

export function card(content: string, accentColor = 'rgba(59,130,246,.3)'): string {
  return `<div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-top:2px solid ${accentColor};border-radius:12px;padding:28px 24px;margin-bottom:16px;">
    ${content}
  </div>`;
}

function statCell(value: string, label: string, color = '#e2eaf5'): string {
  return `<td class="stat-cell-td" style="background:#0a1220;border:1px solid rgba(99,155,255,.08);border-radius:8px;padding:14px;text-align:center;width:33%;">
    <div style="${MONO}font-size:22px;font-weight:700;color:${color};line-height:1;margin-bottom:4px;white-space:nowrap;">${value}</div>
    <div style="${FONT}font-size:10px;color:#4a6080;letter-spacing:.5px;text-transform:uppercase;">${label}</div>
  </td>`;
}

// Ligne de stat-cells : en table pour tous les clients mail, empilée sous 480px (media query d'emailWrapper).
function statsRow(stats: { value: string; label: string; color?: string }[], margin = '20px 0'): string {
  const cells = stats.map((s) => statCell(s.value, s.label, s.color)).join('\n        <td class="stat-gap" style="width:4px;"></td>\n        ');
  return `<table role="presentation" width="100%" cellpadding="4" cellspacing="4" border="0" style="margin:${margin};">
      <tr>
        ${cells}
      </tr>
    </table>`;
}

export function cta(text: string, url: string, style: 'primary' | 'secondary' = 'primary'): string {
  const bg = style === 'primary' ? '#6366f1;background-image:linear-gradient(135deg,#3b82f6,#8b5cf6)' : 'transparent';
  const border = style === 'secondary' ? 'border:1px solid rgba(99,155,255,.3);' : '';
  return `<a href="${url}" style="display:block;background:${bg};${border}color:#ffffff;text-decoration:none;text-align:center;padding:13px 24px;border-radius:9px;${FONT}font-size:14px;font-weight:600;margin-top:20px;">
    ${text}
  </a>`;
}

function aiBlock(text: string): string {
  return `<div style="background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.18);border-radius:8px;padding:14px 16px;margin:16px 0;">
    <span style="color:#a78bfa;font-size:14px;">✦</span>
    <span style="${FONT}font-size:13px;color:#c5d5e8;line-height:1.6;margin-left:8px;">${text}</span>
  </div>`;
}

export const divider = `<div style="height:1px;background:rgba(99,155,255,.08);margin:20px 0;"></div>`;

// ── Weekly Debrief ────────────────────────────────────────────────────────────

export function debriefReadyTemplate(params: {
  userName: string;
  weekNumber: number;
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  /** Devise des comptes du débrief (null = devises différentes : montant sans symbole). */
  currency: string | null;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, weekNumber, winRate, totalPnl, totalTrades, currency, appUrl } = params;
  const pnlColor = totalPnl >= 0 ? '#10b981' : '#ef4444';
  const pnlStr = formatMoney(totalPnl, currency, { decimals: 0 });
  const pnlBg = totalPnl >= 0 ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)';

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Weekly Debrief · Semaine ${weekNumber}</p>
    <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 20px 0;letter-spacing:-.5px;">
      Ton débrief est prêt
    </h1>

    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;">
      Bonjour ${userName || 'Trader'}, ton analyse de la semaine ${weekNumber} vient d'être générée par ton compagnon.
    </p>

    ${statsRow([
      { value: `${winRate.toFixed(1)}%`, label: 'Win Rate', color: '#60a5fa' },
      { value: pnlStr, label: 'P&L', color: pnlColor },
      { value: `${totalTrades}`, label: 'Trades', color: '#e2eaf5' },
    ])}

    ${divider}

    <p style="${FONT}font-size:13px;color:#6b8299;margin:0 0 16px 0;">
      Ton compagnon a analysé tes trades, tes émotions et tes patterns de la semaine.
      Objectifs de la semaine prochaine disponibles dans l'app.
    </p>

    ${cta('Voir mon débrief complet →', `${appUrl}/debrief`)}
  `, pnlBg);

  return {
    subject: `📅 Ton débrief semaine ${weekNumber} est prêt : ${pnlStr}`,
    html: emailWrapper(
      content,
      `Semaine ${weekNumber} : ${winRate.toFixed(0)}% WR · ${pnlStr} · ${totalTrades} trades`,
      totalPnl >= 0 ? ACCENT.success : ACCENT.brand,
    ),
  };
}

// ── Daily Recap ───────────────────────────────────────────────────────────────

export function dailyRecapTemplate(params: {
  userName: string;
  date: Date;
  pnl: number;
  winRate: number;
  tradesCount: number;
  aiOneLiner: string | null;
  /** Devise des comptes du jour (null = devises différentes : montant sans symbole). */
  currency: string | null;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, date, pnl, winRate, tradesCount, aiOneLiner, currency, appUrl } = params;
  const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';
  const pnlStr = formatMoney(pnl, currency, { decimals: 0 });
  const pnlBg = pnl >= 0 ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)';
  const dateStr = date.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Recap session · ${dateStr}</p>
    <h1 style="${FONT}font-size:24px;font-weight:700;color:${pnlColor};margin:0 0 20px 0;letter-spacing:-.5px;">
      ${pnlStr}
    </h1>

    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;">
      Bonjour ${userName || 'Trader'}, voici le bilan de ta session du jour.
    </p>

    ${statsRow([
      { value: pnlStr, label: 'P&L', color: pnlColor },
      { value: `${winRate.toFixed(0)}%`, label: 'Win Rate', color: '#60a5fa' },
      { value: `${tradesCount}`, label: 'Trades', color: '#e2eaf5' },
    ], '0 0 16px 0')}

    ${aiOneLiner ? aiBlock(aiOneLiner) : ''}

    ${divider}

    <p style="${FONT}font-size:12px;color:#6b8299;margin:0 0 16px 0;">
      Ton bilan complet avec l'analyse détaillée est disponible dans l'app.
    </p>

    ${cta('Voir mon dashboard →', `${appUrl}/dashboard`)}
  `, pnlBg);

  return {
    subject: `${pnl >= 0 ? '📈' : '📉'} Session ${dateStr} : ${pnlStr}`,
    html: emailWrapper(
      content,
      `${pnlStr} · ${winRate.toFixed(0)}% WR · ${tradesCount} trades`,
      pnl >= 0 ? ACCENT.success : ACCENT.brand,
    ),
  };
}

// ── Bienvenue FREE ────────────────────────────────────────────────────────────

const DISCORD_INVITE_URL = 'https://discord.gg/TDK2npvkSN';

/**
 * Lien de l'app depuis un e-mail de la suite d'onboarding : UTM `email / onboarding / <clé>`,
 * pour que l'admin Acquisition distingue chaque e-mail.
 */
export function onboardingLink(appUrl: string, path: string, campaign: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...query, utm_source: 'email', utm_medium: 'onboarding', utm_campaign: campaign });
  return `${appUrl.replace(/\/+$/, '')}${path}?${params.toString()}`;
}

/** Prénom : `name` est libre (« Greg Tahir ») → premier mot ; vide → chaîne vide. */
export function firstNameOf(userName: string): string {
  return userName.trim().split(/\s+/)[0] ?? '';
}

/** Lien texte dans un paragraphe (un seul BOUTON par e-mail : le reste en liens). */
export function textLink(label: string, url: string): string {
  return `<a href="${url}" style="color:#60a5fa;text-decoration:underline;">${label}</a>`;
}

function welcomeStep(n: number, title: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px 0;">
      <tr>
        <td width="28" valign="top" style="width:28px;${MONO}font-size:13px;font-weight:700;color:#60a5fa;padding-top:1px;">${n}.</td>
        <td valign="top" style="${FONT}font-size:14px;color:#9db4ce;line-height:1.6;"><strong style="color:#e2eaf5;">${title}</strong> : ${text}</td>
      </tr>
    </table>`;
}

/** Date longue en français (« 16 novembre 2026 »). */
const longDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function welcomeFreeTemplate(params: {
  userName: string;
  appUrl: string;
  /** Fin de l'essai Premium d'inscription (#769), `null` si aucun essai (réinscription récente). */
  trialEndsAt?: Date | null;
}): { subject: string; html: string } {
  const { userName, appUrl, trialEndsAt = null } = params;
  // Pas de bouton ni d'offre : un rappel factuel de l'essai, sans prélèvement à la fin.
  const trialNote = trialEndsAt
    ? `<p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;line-height:1.7;">
        Tu as <strong style="color:#e2eaf5;">${PREMIUM_SIGNUP_TRIAL_DAYS} jours de Premium offerts</strong>
        jusqu'au ${longDate(trialEndsAt)}&nbsp;: alertes avant ta limite, anti-tilt en direct, débrief de ta
        semaine. Ensuite, ton compte repasse en Gratuit tout seul, sans aucun prélèvement.
      </p>`
    : '';
  const firstName = firstNameOf(userName);
  const link = (path: string) => onboardingLink(appUrl, path, 'welcome');

  const content = `
    ${card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Bienvenue</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Ton compte est prêt
      </h1>

      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;line-height:1.7;">
        ${firstName ? `Bonjour ${firstName}` : 'Bonjour'}, ton compte est prêt. Pour que MyTradingCoach te serve
        pendant ta séance, trois étapes suffisent :
      </p>
      ${trialNote}

      ${welcomeStep(1, 'Connecte ton compte Tradovate', 'tes trades arrivent tout seuls, en lecture seule. Aucun ordre n\'est jamais passé.')}
      ${welcomeStep(2, 'Choisis ta prop firm et ton plan', 'la marge restante avant ta limite se calcule avec les vraies règles de ta firme.')}
      ${welcomeStep(3, 'Ouvre ta séance', 'tu vois en direct ce qu\'il te reste avant la limite.')}

      ${cta('Connecter mon compte →', link('/accounts'))}

      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:16px 0 0 0;line-height:1.6;">
        Tu ne trades pas sur Tradovate ? Tu peux ${textLink('importer un fichier CSV ou noter tes trades à la main', link('/journal'))}.
      </p>
    `)}

    <div style="background:#0f1824;border:1px solid rgba(88,101,242,.5);border-radius:12px;padding:20px 24px;margin-bottom:16px;">
      <p style="${FONT}font-size:14px;font-weight:700;color:#e2eaf5;margin:0 0 6px 0;">Discord MyTradingCoach</p>
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0;line-height:1.6;">
        La communauté des utilisateurs : questions, retours, entraide.
        ${textLink('Rejoindre le Discord', DISCORD_INVITE_URL)}
      </p>
    </div>
  `;

  return {
    subject: 'Bienvenue sur MyTradingCoach : 3 étapes pour démarrer',
    html: emailWrapper(content, 'Connecte Tradovate, choisis ta firme, ouvre ta séance.'),
  };
}

// ── Bienvenue PREMIUM ─────────────────────────────────────────────────────────

export function welcomePremiumTemplate(params: {
  userName: string;
  isTrial: boolean;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, isTrial, appUrl } = params;

  // Ce que Premium ajoute : liste partagée avec l'app et la landing (PLAN_BENEFITS, @mtc/shared).
  const features = PLAN_BENEFITS.premium.map((b) => b.text);

  const content = `
    ${card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">
        ${isTrial ? 'Essai gratuit · 30 jours' : 'Premium activé'}
      </p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        ${isTrial ? 'Ton compagnon Premium est actif 🚀' : 'Bienvenue en Premium 🚀'}
      </h1>

      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'},
        ${isTrial
          ? `ton essai gratuit de <strong style="color:#e2eaf5;">30 jours</strong> est activé. Aucun prélèvement avant la fin, annulable en un clic.`
          : `ton abonnement Premium est actif. Profite de toutes les fonctionnalités de ton compagnon.`
        }
      </p>

      <div style="margin:16px 0;">
        ${features.map(f => `
          <div style="margin-bottom:8px;">
            <span style="color:#a78bfa;">✦</span>
            <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">${f}</span>
          </div>
        `).join('')}
      </div>

      ${cta('Accéder à mon dashboard →', appUrl)}
    `, 'rgba(99,92,246,.4)')}

    <div style="background:#0f1824;border:1px solid #5865f2;border-radius:12px;padding:24px;">
      <p style="${FONT}font-size:15px;font-weight:700;color:#e2eaf5;margin:0 0 8px 0;">
        ⭐ Salon Premium sur Discord
      </p>
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 16px 0;line-height:1.6;">
        Réservé aux membres Premium : stratégies avancées, support prioritaire, échanges exclusifs.
        Tape <code style="background:#1e2533;padding:2px 6px;border-radius:4px;color:#00d4aa;font-family:monospace;">/verify</code> dans #👋-bienvenue.
      </p>
      ${cta('Rejoindre le Discord →', 'https://discord.gg/TDK2npvkSN', 'secondary')}
    </div>
  `;

  return {
    subject: isTrial
      ? '🚀 Ton essai Premium démarre'
      : '🚀 Bienvenue en Premium',
    html: emailWrapper(content, isTrial ? '30 jours offerts, aucun prélèvement.' : 'Accès complet activé.'),
  };
}

// ── Reset mot de passe ────────────────────────────────────────────────────────

export function resetPasswordTemplate(params: {
  userName: string;
  resetUrl: string;
  expiresIn: string;
  /** Compte Google sans mot de passe : rappel de la connexion Google, lien pour en définir un. */
  googleOnly?: boolean;
}): { subject: string; html: string } {
  const { userName, resetUrl, expiresIn, googleOnly } = params;

  const intro = googleOnly
    ? `Bonjour ${userName || 'Trader'}, ton compte MyTradingCoach utilise la connexion Google :
      tu peux simplement te connecter avec le bouton « Continuer avec Google ».
      Si tu veux aussi un mot de passe, définis-le avec le lien ci-dessous.`
    : `Bonjour ${userName || 'Trader'}, tu as demandé à réinitialiser ton mot de passe.`;

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Sécurité</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      ${googleOnly ? 'Connexion à ton compte' : 'Réinitialisation du mot de passe'}
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;">
      ${intro}
    </p>
    <p style="${FONT}font-size:12px;color:#6b8299;margin:0 0 20px 0;">
      Ce lien expire dans <strong style="color:#e2eaf5;">${expiresIn}</strong>.
      Si tu n'es pas à l'origine de cette demande, ignore cet email.
    </p>
    ${cta(googleOnly ? 'Définir mon mot de passe →' : 'Réinitialiser mon mot de passe →', resetUrl)}
  `, 'rgba(239,68,68,.3)');

  return {
    subject: googleOnly ? '🔐 Connexion à ton compte MyTradingCoach' : '🔐 Réinitialisation de ton mot de passe',
    html: emailWrapper(content, `Lien valable ${expiresIn}.`, ACCENT.alert),
  };
}

// ── Paiement échoué ───────────────────────────────────────────────────────────

export function paymentFailedTemplate(params: {
  userName: string;
  attemptCount: number;
  portalUrl: string;
}): { subject: string; html: string } {
  const { userName, attemptCount, portalUrl } = params;

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#ef4444;margin:0 0 16px 0;letter-spacing:-.5px;">
      Problème de paiement
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Bonjour ${userName || 'Trader'}, nous n'avons pas pu traiter ton paiement
      ${attemptCount > 1 ? `(tentative ${attemptCount})` : ''}.
      Ton accès Premium reste actif quelques jours le temps de mettre à jour ta carte.
    </p>
    ${cta('Mettre à jour mon paiement →', portalUrl)}
  `, 'rgba(239,68,68,.3)');

  return {
    subject: '⚠️ Paiement échoué',
    html: emailWrapper(content, '', ACCENT.alert),
  };
}

// ── Paiement réussi (renouvellement) ─────────────────────────────────────────

export function paymentSucceededTemplate(params: {
  userName: string;
  amount: string;
  last4?: string;
  nextRenewalDate?: Date | null;
  invoiceUrl?: string;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, amount, last4, nextRenewalDate, invoiceUrl, appUrl } = params;
  const renewalStr = nextRenewalDate?.toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  // Lignes du récapitulatif : un champ inconnu n'est simplement pas affiché.
  const rows: [string, string][] = [['Montant', amount]];
  if (last4) rows.push(['Moyen de paiement', `Carte •••• ${last4}`]);
  if (renewalStr) rows.push(['Prochaine échéance', renewalStr]);

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Ton paiement a bien été reçu
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">
      Bonjour ${userName || 'Trader'}, merci ! Ton abonnement Premium est renouvelé.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a1220;border:1px solid rgba(99,155,255,.08);border-radius:8px;">
      ${rows.map(([label, value], i) => `<tr>
        <td style="${FONT}font-size:12px;color:#6b8299;padding:12px 14px;${i ? 'border-top:1px solid rgba(99,155,255,.08);' : ''}">${label}</td>
        <td align="right" style="${MONO}font-size:13px;color:#e2eaf5;padding:12px 14px;${i ? 'border-top:1px solid rgba(99,155,255,.08);' : ''}">${value}</td>
      </tr>`).join('')}
    </table>
    ${cta('Voir mon dashboard →', `${appUrl}/dashboard`)}
    ${invoiceUrl ? cta('Télécharger la facture', invoiceUrl, 'secondary') : ''}
  `, 'rgba(16,185,129,.3)');

  return {
    subject: `✅ Paiement reçu : ${amount}`,
    html: emailWrapper(content, renewalStr ? `Prochaine échéance le ${renewalStr}.` : 'Merci pour ton paiement.', ACCENT.success),
  };
}

// ── Abonnement résilié ────────────────────────────────────────────────────────

export function subscriptionCanceledTemplate(params: {
  userName: string;
  resubscribeUrl: string;
}): { subject: string; html: string } {
  const { userName, resubscribeUrl } = params;

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Abonnement résilié
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Bonjour ${userName || 'Trader'}, ton abonnement Premium a bien été résilié.
      Tu es maintenant sur le plan gratuit : journal, stats de base et historique illimité restent accessibles.
    </p>
    <p style="${FONT}font-size:13px;color:#6b8299;margin:0 0 20px 0;">
      Tu peux te réabonner à tout moment pour retrouver les analytics avancés, l'IA Coach et les Weekly Debriefs.
    </p>
    ${cta('Me réabonner →', resubscribeUrl, 'secondary')}
  `);

  return {
    subject: 'Ton abonnement MyTradingCoach a été résilié',
    html: emailWrapper(content),
  };
}

// ── Rappel renouvellement ─────────────────────────────────────────────────────

export function renewalReminderTemplate(params: {
  userName: string;
  expiresAt: Date;
  portalUrl: string;
}): { subject: string; html: string } {
  const { userName, expiresAt, portalUrl } = params;
  const dateStr = expiresAt.toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Ton Premium expire dans 7 jours
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Bonjour ${userName || 'Trader'}, ton abonnement Premium expire le
      <strong style="color:#e2eaf5;">${dateStr}</strong>.
      Sans renouvellement, tu passeras automatiquement sur le plan gratuit.
    </p>
    ${cta('Gérer mon abonnement →', portalUrl)}
  `, 'rgba(245,158,11,.3)');

  return {
    subject: '⏳ Ton Premium expire dans 7 jours',
    html: emailWrapper(content, `Expiration le ${dateStr}.`),
  };
}
// ── Offre fondateur et codes partenaires (#525) ─────────────────────────────────


function rulesList(rules: string[]): string {
  return `<div style="margin:16px 0;">${rules
    .map(
      (r) => `<div style="margin-bottom:8px;">
        <span style="color:#60a5fa;">✓</span>
        <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">${r}</span>
      </div>`,
    )
    .join('')}</div>`;
}

/** Confirmation fondateur : numéro, prix bloqué, règles (perte à la résiliation, remboursement 14 j). */
export function founderWelcomeTemplate(params: {
  userName: string;
  number: number;
  /** Ex. « 29,00 € par mois ». */
  priceLabel: string;
  refundUntil: Date;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, number, priceLabel, refundUntil, appUrl } = params;
  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Offre fondateur</p>
    <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Tu es fondateur n° ${number} 🎉
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Salut ${userName || 'Trader'}, merci de faire partie des 200 premiers. Tout Premium est actif,
      nouveautés à venir comprises, à <strong style="color:#e2eaf5;">${priceLabel}</strong>.
    </p>
    ${rulesList([
      'Prix bloqué tant que ton abonnement reste actif, même si le prix normal augmente.',
      'Si tu résilies, le prix fondateur est perdu définitivement.',
      `Satisfait ou remboursé jusqu’au ${longDate(refundUntil)} : il suffit de répondre à cet e-mail.`,
    ])}
    ${cta('Ouvrir MyTradingCoach →', `${appUrl}/dashboard`)}
  `, 'rgba(59,130,246,.35)');
  return {
    subject: `🎉 Tu es fondateur n° ${number}`,
    html: emailWrapper(content, `Prix bloqué à ${priceLabel} tant que ton abonnement reste actif.`),
  };
}

/**
 * Réservation fondateur pendant un Premium offert (#769, B1) : place prise, premier prélèvement à la
 * fin du Premium offert. La bienvenue fondateur (garantie datée) part au premier prélèvement réel.
 */
export function founderReservationTemplate(params: {
  userName: string;
  number: number;
  /** Ex. « 29,00 € par mois ». */
  priceLabel: string;
  firstChargeAt: Date;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, number, priceLabel, firstChargeAt, appUrl } = params;
  const date = longDate(firstChargeAt);
  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Offre fondateur</p>
    <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Ta place fondateur n° ${number} est réservée
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Salut ${userName || 'Trader'}, ton Premium continue. Premier prélèvement de
      <strong style="color:#e2eaf5;">${priceLabel}</strong> le ${date}, pas avant.
    </p>
    ${rulesList([
      'Prix bloqué tant que ton abonnement reste actif, même si le prix normal augmente.',
      `Tu peux annuler avant le ${date} depuis ton profil : aucun prélèvement, la place est rendue.`,
      'Si le prélèvement échoue définitivement, la place est rendue.',
      `Satisfait ou remboursé ${FOUNDER_REFUND_DAYS} jours à partir du premier prélèvement.`,
    ])}
    ${cta('Ouvrir MyTradingCoach →', `${appUrl}/dashboard`)}
  `, 'rgba(59,130,246,.35)');
  return {
    subject: `Ta place fondateur n° ${number} est réservée`,
    html: emailWrapper(content, `Premier prélèvement le ${date}, pas avant.`),
  };
}

/**
 * Prélèvement qui attend une confirmation de la banque (3D Secure, `invoice.payment_action_required`) :
 * Stripe ne retente pas seul (constaté en mode test le 27/10), le lien de la facture permet de confirmer.
 */
export function paymentActionRequiredTemplate(params: {
  userName: string;
  invoiceUrl: string;
}): { subject: string; html: string } {
  const { userName, invoiceUrl } = params;
  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Confirme ton paiement
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Bonjour ${userName || 'Trader'}, ta banque demande une confirmation pour ce prélèvement.
    </p>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Ton Premium est en pause jusqu'à ta confirmation. Tes trades et ton historique restent là. Sans
      confirmation dans les prochains jours, ton abonnement s'arrêtera.
    </p>
    ${cta('Confirmer mon paiement →', invoiceUrl)}
  `, 'rgba(245,158,11,.3)');
  return {
    subject: 'Confirme ton paiement',
    html: emailWrapper(content, 'Ton Premium est en pause jusqu’à la confirmation de ce prélèvement.'),
  };
}

/** Confirmation d'abonnement avec un code partenaire : rappel des conditions obtenues. */
export function partnerWelcomeTemplate(params: {
  userName: string;
  code: string;
  /** Ex. « 29,00 € par mois ». */
  priceLabel: string;
  /** Ex. « 49,00 € par mois ». */
  normalPriceLabel: string;
  /** null = à vie (tant que l'abonnement reste actif). */
  durationMonths: number | null;
  trialEndsAt: Date | null;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, code, priceLabel, normalPriceLabel, durationMonths, trialEndsAt, appUrl } = params;
  const duration = durationMonths === null
    ? 'tant que ton abonnement reste actif'
    : `pendant ${durationMonths} mois, puis ${normalPriceLabel}`;
  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Code partenaire ${code}</p>
    <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Ton tarif partenaire est activé 🚀
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Salut ${userName || 'Trader'}, ton Premium est actif avec le code <strong style="color:#e2eaf5;">${code}</strong>.
    </p>
    ${rulesList([
      ...(trialEndsAt ? [`Essai gratuit jusqu’au ${longDate(trialEndsAt)} : aucun prélèvement avant.`] : []),
      `Ensuite <strong style="color:#e2eaf5;">${priceLabel}</strong>, ${duration}.`,
      'Ces conditions sont figées : elles ne changent pas même si le code évolue.',
      'Si tu résilies, le tarif partenaire est perdu.',
    ])}
    ${cta('Ouvrir MyTradingCoach →', `${appUrl}/dashboard`)}
  `, 'rgba(59,130,246,.35)');
  return {
    subject: `🚀 Ton tarif partenaire ${code} est activé`,
    html: emailWrapper(content, `${priceLabel} avec le code ${code}.`),
  };
}

/** Échec de paiement d'un fondateur ou d'un abonné partenaire : le tarif est en jeu. */
export function tariffAtRiskTemplate(params: {
  userName: string;
  kind: 'founder' | 'partner';
  /** Ex. « 29,00 € par mois ». */
  priceLabel: string;
  attemptCount: number;
  portalUrl: string;
}): { subject: string; html: string } {
  const { userName, kind, priceLabel, attemptCount, portalUrl } = params;
  const tariff = kind === 'founder' ? 'tarif fondateur' : 'tarif partenaire';
  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#f59e0b;margin:0 0 16px 0;letter-spacing:-.5px;">
      Ton ${tariff} est en jeu
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Salut ${userName || 'Trader'}, ton dernier paiement n’est pas passé${attemptCount > 1 ? ` (tentative ${attemptCount})` : ''}.
      Rien n’est perdu pour l’instant : on réessaie dans les prochains jours.
    </p>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;line-height:1.7;">
      Si aucun paiement ne passe, l’abonnement s’arrête et ton ${tariff} à
      <strong style="color:#e2eaf5;">${priceLabel}</strong> est perdu définitivement.
      Mets ta carte à jour pour le garder.
    </p>
    ${cta('Mettre à jour ma carte →', portalUrl)}
  `, 'rgba(245,158,11,.35)');
  return {
    subject: `⚠️ Ton ${tariff} est en jeu`,
    html: emailWrapper(content, `Mets ta carte à jour pour garder ${priceLabel}.`, ACCENT.alert),
  };
}

/** Rappel avant la reconduction d'un abonnement ANNUEL : date et montant réellement prélevé. */
export function annualRenewalReminderTemplate(params: {
  userName: string;
  /** Montant réel de la prochaine facture, remises comprises. Ex. « 290,00 € ». */
  amount: string;
  renewalDate: Date;
  /** Tarif conservé (fondateur n° X, code partenaire) : précisé dans le message. */
  keptTariff: string | null;
  portalUrl: string;
}): { subject: string; html: string } {
  const { userName, amount, renewalDate, keptTariff, portalUrl } = params;
  const dateStr = longDate(renewalDate);
  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Facturation</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Ton abonnement annuel se renouvelle le ${dateStr}
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;line-height:1.7;">
      Salut ${userName || 'Trader'}, ton abonnement Premium annuel sera reconduit automatiquement le
      <strong style="color:#e2eaf5;">${dateStr}</strong> pour <strong style="color:#e2eaf5;">${amount}</strong>${keptTariff ? ` (${keptTariff} conservé)` : ''}.
    </p>
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 20px 0;line-height:1.7;">
      Rien à faire pour continuer. Pour l’arrêter, résilie avant cette date depuis ton profil : tu gardes Premium jusqu’à la fin de la période payée.
    </p>
    ${cta('Gérer mon abonnement →', portalUrl)}
  `, 'rgba(59,130,246,.3)');
  return {
    subject: `Ton abonnement annuel se renouvelle le ${dateStr}`,
    html: emailWrapper(content, `${amount} le ${dateStr}.`),
  };
}
