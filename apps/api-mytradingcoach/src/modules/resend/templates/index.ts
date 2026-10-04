// ── Templates emails MyTradingCoach ─────────────────────────────────────────
// Templates HTML inline : pas de dépendance externe pour le rendu
import { formatMoney } from '@mtc/shared';

// ── Base système ──────────────────────────────────────────────────────────────

export const FONT = `font-family: 'Inter', -apple-system, Arial, sans-serif;`;
const MONO = `font-family: 'JetBrains Mono', 'Courier New', monospace;`;
const BRAND_FONT = `font-family: 'Space Grotesk', 'Inter', -apple-system, Arial, sans-serif;`;

// Pied de page marketing : mention RGPD + lien de désinscription obligatoire.
// Réutilisé par les templates de campagnes marketing (campaign-registry).
export function marketingFooter(unsubUrl: string): string {
  return `<p style="${FONT}font-size:12px;color:#6b8299;line-height:1.6;margin:18px 0 0 0;text-align:center;">
    Tu reçois cet email parce que tu as un compte MyTradingCoach.
    <a href="${unsubUrl}" style="color:#8fa3bf;text-decoration:underline;">Me désinscrire des emails</a>.
  </p>`;
}

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

export function emailWrapper(content: string, preheader = '', accentGradient: string = ACCENT.brand): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <!-- Thème sombre assumé : empêche Apple Mail / iOS d'imposer un fond clair -->
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <style>:root { color-scheme: dark; supported-color-schemes: dark; } body { margin:0; padding:0; background:#080c14; }</style>
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
                <a href="https://app.mytradingcoach.app/parametres" style="color:#9db4ce;text-decoration:none;">Se désabonner</a>
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
  return `<td style="background:#0a1220;border:1px solid rgba(99,155,255,.08);border-radius:8px;padding:14px;text-align:center;width:33%;">
    <div style="${MONO}font-size:22px;font-weight:700;color:${color};line-height:1;margin-bottom:4px;">${value}</div>
    <div style="${FONT}font-size:10px;color:#4a6080;letter-spacing:.5px;text-transform:uppercase;">${label}</div>
  </td>`;
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

    <table width="100%" cellpadding="4" cellspacing="4" border="0" style="margin:20px 0;">
      <tr>
        ${statCell(`${winRate.toFixed(1)}%`, 'Win Rate', '#60a5fa')}
        <td style="width:4px;"></td>
        ${statCell(pnlStr, 'P&L', pnlColor)}
        <td style="width:4px;"></td>
        ${statCell(`${totalTrades}`, 'Trades', '#e2eaf5')}
      </tr>
    </table>

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

    <table width="100%" cellpadding="4" cellspacing="4" border="0" style="margin:0 0 16px 0;">
      <tr>
        ${statCell(pnlStr, 'P&L', pnlColor)}
        <td style="width:4px;"></td>
        ${statCell(`${winRate.toFixed(0)}%`, 'Win Rate', '#60a5fa')}
        <td style="width:4px;"></td>
        ${statCell(`${tradesCount}`, 'Trades', '#e2eaf5')}
      </tr>
    </table>

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

export function welcomeFreeTemplate(params: {
  userName: string;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, appUrl } = params;

  const content = `
    ${card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Bienvenue</p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        Ton compagnon de trading est prêt 👋
      </h1>

      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'}, ton compte MyTradingCoach est créé.
        Tu peux maintenant enregistrer tes trades, suivre tes émotions et analyser tes performances.
      </p>

      <div style="margin:16px 0;">
        <div style="margin-bottom:10px;">
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Trades illimités · Journal complet · Stats de base</span>
        </div>
        <div style="margin-bottom:10px;">
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Mood check matin · Session live · Calendrier d'activité</span>
        </div>
        <div>
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Multi-marché : Futures, Crypto, Forex, Indices</span>
        </div>
      </div>

      ${divider}

      ${cta('Accéder à mon journal →', appUrl)}
    `)}

    <div style="background:#0f1824;border:1px solid #5865f2;border-radius:12px;padding:24px;margin-bottom:16px;">
      <p style="${FONT}font-size:15px;font-weight:700;color:#e2eaf5;margin:0 0 8px 0;">💬 Rejoins la communauté Discord</p>
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 16px 0;line-height:1.6;">
        Traders ICT · SMC · Price Action · Crypto · Futures.
        Partage tes setups, pose tes questions, reçois un support direct.
      </p>
      ${cta('Rejoindre le Discord →', 'https://discord.gg/TDK2npvkSN', 'secondary')}
    </div>

    <div style="background:rgba(59,130,246,.04);border:1px solid rgba(59,130,246,.12);border-radius:8px;padding:16px;text-align:center;">
      <p style="${FONT}font-size:12px;color:#6b8299;margin:0;">
        Tu veux la couche IA ? <a href="${appUrl}/parametres" style="color:#60a5fa;text-decoration:none;font-weight:600;">Essaie Premium 1 mois offert</a> :
        analytics avancés, IA Coach et Weekly Debrief automatique.
      </p>
    </div>
  `;

  return {
    subject: '👋 Bienvenue sur MyTradingCoach, ton compagnon de trading',
    html: emailWrapper(content, 'Ton journal de trading intelligent est prêt.'),
  };
}

// ── Bienvenue PREMIUM ─────────────────────────────────────────────────────────

export function welcomePremiumTemplate(params: {
  userName: string;
  isTrial: boolean;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, isTrial, appUrl } = params;

  const features = [
    'Trades illimités',
    'Analytics avancés : heatmap, equity curve, drawdown',
    'Analyse IA de chaque session + phrase coaching',
    'Calendrier économique filtré pour tes actifs',
    'Weekly Debrief IA automatique chaque dimanche',
    'Score trader /100 · Export PDF',
  ];

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
}): { subject: string; html: string } {
  const { userName, resetUrl, expiresIn } = params;

  const content = card(`
    <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">Sécurité</p>
    <h1 style="${FONT}font-size:22px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
      Réinitialisation du mot de passe
    </h1>
    <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 12px 0;">
      Bonjour ${userName || 'Trader'}, tu as demandé à réinitialiser ton mot de passe.
    </p>
    <p style="${FONT}font-size:12px;color:#6b8299;margin:0 0 20px 0;">
      Ce lien expire dans <strong style="color:#e2eaf5;">${expiresIn}</strong>.
      Si tu n'es pas à l'origine de cette demande, ignore cet email.
    </p>
    ${cta('Réinitialiser mon mot de passe →', resetUrl)}
  `, 'rgba(239,68,68,.3)');

  return {
    subject: '🔐 Réinitialisation de ton mot de passe',
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