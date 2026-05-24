// ── Templates emails MyTradingCoach ─────────────────────────────────────────
// Templates HTML inline — pas de dépendance externe pour le rendu

const BASE_STYLE = `
  font-family: 'DM Sans', Arial, sans-serif;
  background-color: #080c14;
  color: #e2eaf5;
  max-width: 600px;
  margin: 0 auto;
  padding: 40px 24px;
`;

const CARD_STYLE = `
  background-color: #0f1824;
  border: 1px solid rgba(99,155,255,.1);
  border-radius: 12px;
  padding: 32px;
  margin: 24px 0;
`;

const BTN_STYLE = `
  display: inline-block;
  background-color: #3b82f6;
  color: #ffffff;
  text-decoration: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  margin-top: 20px;
`;

const MUTED_STYLE = `color: #8fa3bf; font-size: 13px; margin-top: 32px;`;

// ── Paiement échoué ──────────────────────────────────────────────────────────

export function paymentFailedTemplate(params: {
  userName: string;
  attemptCount: number;
  portalUrl: string;
}): { subject: string; html: string } {
  const { userName, attemptCount, portalUrl } = params;

  return {
    subject: '⚠️ Votre paiement MyTradingCoach a échoué',
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          ⚠️ Problème de paiement
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">MyTradingCoach — Facturation</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          <p>
            Nous n'avons pas pu traiter votre paiement
            ${attemptCount > 1 ? `(tentative ${attemptCount})` : ''}.
            Votre accès PREMIUM reste actif pendant quelques jours le temps
            que vous mettiez à jour votre moyen de paiement.
          </p>
          <p><strong>Action requise : mettez à jour votre carte bancaire.</strong></p>
          <a href="${portalUrl}" style="${BTN_STYLE}">
            Mettre à jour mon paiement →
          </a>
        </div>

        <p style="${MUTED_STYLE}">
          Si vous avez des questions, contactez-nous à
          <a href="mailto:support@mytradingcoach.app" style="color:#60a5fa;">
            support@mytradingcoach.app
          </a>
        </p>
      </div>
    `,
  };
}

// ── Abonnement résilié ───────────────────────────────────────────────────────

export function subscriptionCanceledTemplate(params: {
  userName: string;
  resubscribeUrl: string;
}): { subject: string; html: string } {
  const { userName, resubscribeUrl } = params;

  return {
    subject: 'Votre abonnement MyTradingCoach a été résilié',
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          Abonnement résilié
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">MyTradingCoach — Facturation</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          <p>
            Votre abonnement PREMIUM a bien été résilié. Vous êtes maintenant
            sur le plan gratuit avec accès à 50 trades/mois et l'historique complet.
          </p>
          <p>
            Vous pouvez vous réabonner à tout moment pour retrouver les
            analytics avancés, l'IA Coach et les Weekly Debriefs.
          </p>
          <a href="${resubscribeUrl}" style="${BTN_STYLE}">
            Me réabonner →
          </a>
        </div>

        <p style="${MUTED_STYLE}">
          Des questions ? Écrivez-nous :
          <a href="mailto:support@mytradingcoach.app" style="color:#60a5fa;">
            support@mytradingcoach.app
          </a>
        </p>
      </div>
    `,
  };
}

// ── Bienvenue FREE ───────────────────────────────────────────────────────────

export function welcomeFreeTemplate(params: {
  userName: string;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, appUrl } = params;

  return {
    subject: '👋 Bienvenue sur MyTradingCoach !',
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          👋 Bienvenue sur MyTradingCoach !
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">Le journal de trading intelligent</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          <p>
            Ton compte est créé. Tu peux maintenant enregistrer tes trades,
            suivre tes émotions et analyser tes performances.
          </p>
          <p style="color:#8fa3bf;">Avec ton plan gratuit :</p>
          <ul style="color:#8fa3bf; padding-left:20px; line-height:1.8;">
            <li>✅ 50 trades par mois</li>
            <li>✅ Journal complet — émotions, setup, notes</li>
            <li>✅ Stats de base — win rate, P&L, top session</li>
            <li>✅ Historique illimité</li>
          </ul>
          <a href="${appUrl}" style="${BTN_STYLE}">
            Accéder à mon journal →
          </a>
        </div>

        <div style="background:#1a1f2e; border:2px solid #5865f2; border-radius:12px; padding:20px; margin:16px 0;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
            <span style="font-size:24px;">💬</span>
            <div>
              <p style="color:#e2eaf5; font-weight:700; font-size:15px; margin:0;">
                Rejoins la communauté Discord
              </p>
              <p style="color:#8fa3bf; font-size:12px; margin:0;">
                Traders ICT · SMC · Price Action · Crypto · Forex · Futures
              </p>
            </div>
          </div>
          <p style="color:#b0bec5; font-size:13px; line-height:1.6; margin:0 0 16px 0;">
            Notre Discord c'est là où tu vas trouver des traders qui ont les mêmes questions
            que toi, partager tes setups, poster tes wins de la semaine et avoir un support direct.
            <br/><strong style="color:#e2eaf5;">Ça te prend 2 minutes.</strong>
          </p>
          <a href="https://discord.gg/TDK2npvkSN" style="${BTN_STYLE}">
            Rejoindre le Discord →
          </a>
          <div style="background:#0f1219; border-radius:8px; padding:12px 14px;">
            <p style="color:#8fa3bf; font-size:12px; margin:0; line-height:1.7;">
              📌 Une fois sur le serveur, tape <code style="background:#1e2533; padding:2px 6px; border-radius:4px; color:#00d4aa; font-family:monospace;">/verify</code>
              dans <strong style="color:#e2eaf5;">#👋-bienvenue</strong> avec ton email MyTradingCoach
              pour obtenir ton rôle <strong style="color:#00d4aa;">Membre</strong> automatiquement.
            </p>
          </div>
        </div>

        <p style="color:#8fa3bf; font-size:13px; margin-top:24px;">
          Tu veux aller plus loin ? Essaie le Premium 7 jours gratuits —
          analytics avancés, IA Coach et Weekly Debrief automatique.
        </p>

        <p style="${MUTED_STYLE}">
          MyTradingCoach — Fait en France 🇫🇷
        </p>
      </div>
    `,
  };
}

// ── Reset mot de passe ───────────────────────────────────────────────────────

export function resetPasswordTemplate(params: {
  userName: string;
  resetUrl: string;
  expiresIn: string;
}): { subject: string; html: string } {
  const { userName, resetUrl, expiresIn } = params;

  return {
    subject: '🔐 Réinitialisation de votre mot de passe MyTradingCoach',
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          🔐 Réinitialisation du mot de passe
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">MyTradingCoach — Sécurité</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          <p>
            Vous avez demandé à réinitialiser votre mot de passe.
            Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
          </p>
          <p style="color:#8fa3bf; font-size:13px;">
            Ce lien expire dans ${expiresIn}.
          </p>
          <a href="${resetUrl}" style="${BTN_STYLE}">
            Réinitialiser mon mot de passe →
          </a>
        </div>

        <p style="color:#8fa3bf; font-size:13px; margin-top:24px;">
          Si vous n'avez pas demandé cette réinitialisation,
          ignorez cet email. Votre mot de passe n'a pas été modifié.
        </p>

        <p style="${MUTED_STYLE}">
          MyTradingCoach — Fait en France 🇫🇷
        </p>
      </div>
    `,
  };
}

// ── Débrief prêt ────────────────────────────────────────────────────────────

export function debriefReadyTemplate(params: {
  userName: string;
  weekNumber: number;
  winRate: number;
  totalPnl: number;
  totalTrades: number;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, weekNumber, winRate, totalPnl, totalTrades, appUrl } =
    params;
  const pnlColor = totalPnl >= 0 ? '#10b981' : '#ef4444';
  const pnlSign = totalPnl >= 0 ? '+' : '';

  return {
    subject: `Ton débrief semaine ${weekNumber} est prêt 📅`,
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          📅 Ton débrief semaine ${weekNumber} est prêt
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">MyTradingCoach — Weekly Debrief</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          <p>Ton analyse de la semaine ${weekNumber} vient d'être générée. Voici un aperçu :</p>

          <div style="display:flex; gap:24px; margin:20px 0; flex-wrap:wrap;">
            <div style="text-align:center;">
              <div style="font-size:24px; font-weight:700; color:#60a5fa; font-family:'DM Mono',monospace;">
                ${winRate.toFixed(1)}%
              </div>
              <div style="font-size:12px; color:#8fa3bf; margin-top:4px;">Win Rate</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:24px; font-weight:700; color:${pnlColor}; font-family:'DM Mono',monospace;">
                ${pnlSign}${totalPnl.toFixed(2)}$
              </div>
              <div style="font-size:12px; color:#8fa3bf; margin-top:4px;">P&amp;L</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:24px; font-weight:700; color:#e2eaf5; font-family:'DM Mono',monospace;">
                ${totalTrades}
              </div>
              <div style="font-size:12px; color:#8fa3bf; margin-top:4px;">Trades</div>
            </div>
          </div>

          <a href="${appUrl}/debrief" style="${BTN_STYLE}">
            Voir mon débrief complet →
          </a>
        </div>

        <p style="${MUTED_STYLE}">MyTradingCoach — Ton journal de trading intelligent</p>
      </div>
    `,
  };
}

// ── Rappel renouvellement ────────────────────────────────────────────────────

export function renewalReminderTemplate(params: {
  userName: string;
  expiresAt: Date;
  portalUrl: string;
}): { subject: string; html: string } {
  const { userName, expiresAt, portalUrl } = params;
  const dateStr = expiresAt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return {
    subject: 'Ton abonnement Premium expire dans 7 jours ⚠️',
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          ⚠️ Ton abonnement expire bientôt
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">MyTradingCoach — Facturation</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          <p>
            Ton abonnement PREMIUM expire le <strong style="color:#e2eaf5;">${dateStr}</strong>,
            soit dans <strong>7 jours</strong>.
          </p>
          <p style="color:#8fa3bf;">
            Si tu ne fais rien, tu basculeras automatiquement sur le plan gratuit
            et perdras l'accès aux analytics avancés, à l'IA Coach et aux Weekly Debriefs.
          </p>
          <a href="${portalUrl}" style="${BTN_STYLE}">
            Renouveler mon abonnement →
          </a>
        </div>

        <p style="${MUTED_STYLE}">
          Pour toute question :
          <a href="mailto:support@mytradingcoach.app" style="color:#60a5fa;">
            support@mytradingcoach.app
          </a>
        </p>
      </div>
    `,
  };
}

// ── Daily Recap ──────────────────────────────────────────────────────────────

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
  const dateStr = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return {
    subject: `Recap session ${dateStr} — ${pnlStr}`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#080c14;color:#e2eaf5;font-family:'DM Sans',Arial,sans-serif;padding:32px;max-width:480px;margin:0 auto;">
  <div style="margin-bottom:24px;">
    <span style="font-family:'Syne',Arial,sans-serif;font-size:18px;font-weight:700;">MyTradingCoach</span>
  </div>
  <h2 style="font-size:20px;margin-bottom:4px;">Session du ${dateStr}</h2>
  <p style="color:#8fa3bf;font-size:13px;margin-top:0;">Bonjour ${userName || 'Trader'}, voici ton recap du jour.</p>
  <div style="display:flex;gap:12px;margin:20px 0;flex-wrap:wrap;">
    <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:8px;padding:12px;text-align:center;flex:1;min-width:80px;">
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:${pnlColor};">${pnlStr}</div>
      <div style="font-size:10px;color:#4a6080;">P&amp;L</div>
    </div>
    <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:8px;padding:12px;text-align:center;flex:1;min-width:80px;">
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;">${winRate.toFixed(0)}%</div>
      <div style="font-size:10px;color:#4a6080;">Win Rate</div>
    </div>
    <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:8px;padding:12px;text-align:center;flex:1;min-width:80px;">
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;">${tradesCount}</div>
      <div style="font-size:10px;color:#4a6080;">Trades</div>
    </div>
  </div>
  ${aiOneLiner ? `<div style="background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.18);border-radius:8px;padding:14px;font-size:13px;color:#e2eaf5;line-height:1.5;margin-bottom:20px;">✦ ${aiOneLiner}</div>` : ''}
  <a href="${appUrl}/dashboard" style="display:block;background:#3b82f6;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Ouvrir mon dashboard →</a>
  <p style="color:#8fa3bf;font-size:12px;margin-top:24px;">MyTradingCoach — Ton journal de trading intelligent</p>
</body>
</html>`,
  };
}

// ── Bienvenue PREMIUM ────────────────────────────────────────────────────────

export function welcomePremiumTemplate(params: {
  userName: string;
  isTrial: boolean;
  appUrl: string;
}): { subject: string; html: string } {
  const { userName, isTrial, appUrl } = params;

  const subject = isTrial
    ? '🚀 Votre essai PREMIUM démarre maintenant — MyTradingCoach'
    : '🚀 Bienvenue dans MyTradingCoach PREMIUM !';

  return {
    subject,
    html: `
      <div style="${BASE_STYLE}">
        <h1 style="color:#e2eaf5; font-size:22px; margin-bottom:8px;">
          🚀 ${isTrial ? 'Votre essai gratuit commence !' : 'Bienvenue en PREMIUM !'}
        </h1>
        <p style="color:#8fa3bf; margin-top:0;">MyTradingCoach</p>

        <div style="${CARD_STYLE}">
          <p>Bonjour ${userName || 'Trader'},</p>
          ${
            isTrial
              ? `<p>Votre essai gratuit de <strong>7 jours</strong> est activé.
                 Aucun prélèvement pendant la période d'essai.</p>`
              : `<p>Votre abonnement PREMIUM est actif. Profitez de toutes les fonctionnalités.</p>`
          }
          <ul style="color:#8fa3bf; padding-left: 20px; line-height: 1.8;">
            <li>✅ Trades illimités</li>
            <li>✅ Analytics avancés (par setup, émotion, heure)</li>
            <li>✅ IA Insights & Chat Coach</li>
            <li>✅ Weekly Debrief automatique</li>
            <li>✅ Score Trader & Export PDF</li>
          </ul>
          <a href="${appUrl}" style="${BTN_STYLE}">
            Accéder à mon tableau de bord →
          </a>
        </div>

        <div style="${CARD_STYLE}">
          <p style="margin:0 0 8px 0;">👥 <strong>Accède au salon ⭐ Premium sur Discord</strong></p>
          <p style="color:#8fa3bf; margin:0 0 12px 0;">
            Réservé aux membres Premium — stratégies avancées,
            support prioritaire et échanges exclusifs.
          </p>
          <a href="https://discord.gg/TDK2npvkSN" style="${BTN_STYLE}">
            Rejoindre le Discord →
          </a>
          <p style="color:#8fa3bf; font-size:12px; margin-top:12px;">
            Tape <code>/verify</code> dans #👋-bienvenue pour débloquer ton accès Premium.
          </p>
        </div>

        <p style="${MUTED_STYLE}">
          MyTradingCoach — Votre journal de trading intelligent
        </p>
      </div>
    `,
  };
}
