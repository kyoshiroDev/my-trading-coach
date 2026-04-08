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

        <p style="${MUTED_STYLE}">
          MyTradingCoach — Votre journal de trading intelligent
        </p>
      </div>
    `,
  };
}
