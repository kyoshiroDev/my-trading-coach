// ── Templates emails MyTradingCoach ─────────────────────────────────────────
// Templates HTML inline — pas de dépendance externe pour le rendu

// ── Base système ──────────────────────────────────────────────────────────────

const FONT = `font-family: 'DM Sans', -apple-system, Arial, sans-serif;`;
const MONO = `font-family: 'DM Mono', 'Courier New', monospace;`;

function emailWrapper(content: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>MyTradingCoach</title>
</head>
<body style="margin:0;padding:0;background:#080c14;${FONT}">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080c14;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;">

          <!-- HEADER -->
          <tr>
            <td style="padding-bottom:24px;">
              <div style="display:inline-flex;align-items:center;gap:8px;">
                <div style="width:8px;height:8px;border-radius:50%;background:#22d3ee;display:inline-block;"></div>
                <span style="${FONT}font-size:15px;font-weight:700;color:#e2eaf5;letter-spacing:-.3px;">MyTradingCoach</span>
              </div>
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
            <td style="padding-top:32px;border-top:1px solid rgba(99,155,255,.08);margin-top:32px;">
              <p style="${FONT}font-size:11px;color:#3d5268;line-height:1.6;margin:0;">
                MyTradingCoach · Fait en France 🇫🇷 · SIRET 512 926 460 00027<br>
                <a href="https://www.mytradingcoach.app" style="color:#3d5268;text-decoration:none;">mytradingcoach.app</a>
                · <a href="https://app.mytradingcoach.app/parametres" style="color:#3d5268;text-decoration:none;">Se désabonner</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function card(content: string, accentColor = 'rgba(59,130,246,.3)'): string {
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

function cta(text: string, url: string, style: 'primary' | 'secondary' = 'primary'): string {
  const bg = style === 'primary' ? 'linear-gradient(90deg,#3b82f6,#6366f1)' : 'transparent';
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

const divider = `<div style="height:1px;background:rgba(99,155,255,.08);margin:20px 0;"></div>`;

// ── Weekly Debrief ────────────────────────────────────────────────────────────

export function debriefReadyTemplate(params: {
  userName: string;
  weekNumber: number;
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, weekNumber, winRate, totalPnl, totalTrades, appUrl } = params;
  const pnlColor = totalPnl >= 0 ? '#10b981' : '#ef4444';
  const pnlStr = `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}$`;
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
    subject: `📅 Ton débrief semaine ${weekNumber} est prêt — ${pnlStr}`,
    html: emailWrapper(content, `Semaine ${weekNumber} : ${winRate.toFixed(0)}% WR · ${pnlStr} · ${totalTrades} trades`),
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
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, date, pnl, winRate, tradesCount, aiOneLiner, appUrl } = params;
  const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444';
  const pnlStr = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}$`;
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
    subject: `${pnl >= 0 ? '📈' : '📉'} Session ${dateStr} — ${pnlStr}`,
    html: emailWrapper(content, `${pnlStr} · ${winRate.toFixed(0)}% WR · ${tradesCount} trades`),
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
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">30 trades par mois · Journal complet · Stats de base</span>
        </div>
        <div style="margin-bottom:10px;">
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Mood check matin · Session live · Calendrier d'activité</span>
        </div>
        <div>
          <span style="color:#10b981;">✓</span>
          <span style="${FONT}font-size:13px;color:#9db4ce;margin-left:8px;">Multi-marché — Futures, Crypto, Forex, Indices</span>
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
        Envie d'aller plus loin ? <a href="${appUrl}/parametres" style="color:#60a5fa;text-decoration:none;font-weight:600;">Essaie Premium 7 jours gratuits</a> —
        analytics avancés, IA Coach, Weekly Debrief automatique.
      </p>
    </div>
  `;

  return {
    subject: '👋 Bienvenue sur MyTradingCoach — ton compagnon de trading',
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
    'Analytics avancés — heatmap, equity curve, drawdown',
    'Analyse IA de chaque session + phrase coaching',
    'Calendrier économique filtré pour tes actifs',
    'Weekly Debrief IA automatique chaque dimanche',
    'Score trader /100 · Export PDF',
  ];

  const content = `
    ${card(`
      <p style="${FONT}font-size:13px;color:#8fa3bf;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.8px;">
        ${isTrial ? 'Essai gratuit · 7 jours' : 'Premium activé'}
      </p>
      <h1 style="${FONT}font-size:24px;font-weight:700;color:#e2eaf5;margin:0 0 16px 0;letter-spacing:-.5px;">
        ${isTrial ? 'Ton compagnon Premium est actif 🚀' : 'Bienvenue en Premium 🚀'}
      </h1>

      <p style="${FONT}font-size:14px;color:#9db4ce;margin:0 0 20px 0;line-height:1.7;">
        Bonjour ${userName || 'Trader'},
        ${isTrial
          ? `ton essai gratuit de <strong style="color:#e2eaf5;">7 jours</strong> est activé. Aucun prélèvement avant la fin.`
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
        Réservé aux membres Premium — stratégies avancées, support prioritaire, échanges exclusifs.
        Tape <code style="background:#1e2533;padding:2px 6px;border-radius:4px;color:#00d4aa;font-family:monospace;">/verify</code> dans #👋-bienvenue.
      </p>
      ${cta('Rejoindre le Discord →', 'https://discord.gg/TDK2npvkSN', 'secondary')}
    </div>
  `;

  return {
    subject: isTrial
      ? '🚀 Ton essai Premium démarre — MyTradingCoach'
      : '🚀 Bienvenue en Premium — MyTradingCoach',
    html: emailWrapper(content, isTrial ? '7 jours gratuits, aucun prélèvement.' : 'Accès complet activé.'),
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
    subject: '🔐 Réinitialisation de ton mot de passe — MyTradingCoach',
    html: emailWrapper(content, `Lien valable ${expiresIn}.`),
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
    subject: '⚠️ Paiement échoué — MyTradingCoach',
    html: emailWrapper(content),
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
      Tu es maintenant sur le plan gratuit — journal, stats de base et historique illimité restent accessibles.
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
    subject: '⏳ Ton Premium expire dans 7 jours — MyTradingCoach',
    html: emailWrapper(content, `Expiration le ${dateStr}.`),
  };
}