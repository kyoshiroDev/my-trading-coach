import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dirname, '../.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const idx = l.indexOf('='); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]; }),
);

const resend = new Resend(env.RESEND_API_KEY);

const BASE_STYLE = `font-family:'DM Sans',Arial,sans-serif;background-color:#080c14;color:#e2eaf5;max-width:600px;margin:0 auto;padding:40px 24px;`;
const CARD_STYLE = `background-color:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:12px;padding:32px;margin:24px 0;`;
const BTN_STYLE = `display:inline-block;background-color:#3b82f6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin-top:20px;`;
const MUTED_STYLE = `color:#8fa3bf;font-size:13px;margin-top:32px;`;

const weekNumber = 17;
const winRate = 66.7;
const totalPnl = 940;
const totalTrades = 12;
const appUrl = env.FRONTEND_URL || 'http://localhost:4200';

const pnlColor = totalPnl >= 0 ? '#10b981' : '#ef4444';
const pnlSign = totalPnl >= 0 ? '+' : '';

const html = `
  <div style="${BASE_STYLE}">
    <h1 style="color:#e2eaf5;font-size:22px;margin-bottom:8px;">
      📅 Ton débrief semaine ${weekNumber} est prêt
    </h1>
    <p style="color:#8fa3bf;margin-top:0;">MyTradingCoach — Weekly Debrief</p>

    <div style="${CARD_STYLE}">
      <p>Bonjour Gregory,</p>
      <p>Ton analyse de la semaine ${weekNumber} vient d'être générée. Voici un aperçu :</p>

      <div style="display:flex;gap:32px;margin:20px 0;flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#60a5fa;font-family:'DM Mono',monospace;">
            ${winRate.toFixed(1)}%
          </div>
          <div style="font-size:12px;color:#8fa3bf;margin-top:4px;">Win Rate</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:700;color:${pnlColor};font-family:'DM Mono',monospace;">
            ${pnlSign}${totalPnl.toFixed(2)}$
          </div>
          <div style="font-size:12px;color:#8fa3bf;margin-top:4px;">P&amp;L</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#e2eaf5;font-family:'DM Mono',monospace;">
            ${totalTrades}
          </div>
          <div style="font-size:12px;color:#8fa3bf;margin-top:4px;">Trades</div>
        </div>
      </div>

      <p style="color:#8fa3bf;font-style:italic;border-left:3px solid rgba(99,155,255,.3);padding-left:12px;margin:16px 0;">
        "Semaine 17 solide avec un PnL de +940$ sur 12 trades et un win rate de 66,7% — deux trades problématiques (FEAR et REVENGE) rappellent que la gestion émotionnelle reste le nerf de la guerre."
      </p>

      <a href="${appUrl}/debrief" style="${BTN_STYLE}">
        Voir mon débrief complet →
      </a>
    </div>

    <p style="${MUTED_STYLE}">MyTradingCoach — Ton journal de trading intelligent 🇫🇷</p>
  </div>
`;

const { data, error } = await resend.emails.send({
  from: `MyTradingCoach <${env.MAIL_FROM || 'noreply@mytradingcoach.app'}>`,
  to: 'tahir.gregory@gmail.com',
  subject: `Ton débrief semaine ${weekNumber} est prêt 📅`,
  html,
  replyTo: env.MAIL_SAV || 'support@mytradingcoach.app',
});

if (error) {
  console.error('❌ Erreur :', error.message);
  process.exit(1);
}

console.log('✅ Email débrief envoyé — id:', data.id);
