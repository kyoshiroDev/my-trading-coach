import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Charger le .env manuellement
const envPath = resolve(__dirname, '../.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = Object.fromEntries(
  envContent
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const resend = new Resend(env.RESEND_API_KEY);

const BASE_STYLE = `font-family:'DM Sans',Arial,sans-serif;background-color:#080c14;color:#e2eaf5;max-width:600px;margin:0 auto;padding:40px 24px;`;
const CARD_STYLE = `background-color:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:12px;padding:32px;margin:24px 0;`;
const BTN_STYLE = `display:inline-block;background-color:#3b82f6;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin-top:20px;`;
const MUTED_STYLE = `color:#8fa3bf;font-size:13px;margin-top:32px;`;

const appUrl = env.FRONTEND_URL || 'http://localhost:4200';

const html = `
  <div style="${BASE_STYLE}">
    <h1 style="color:#e2eaf5;font-size:22px;margin-bottom:8px;">
      🚀 Bienvenue en PREMIUM !
    </h1>
    <p style="color:#8fa3bf;margin-top:0;">MyTradingCoach</p>

    <div style="${CARD_STYLE}">
      <p>Bonjour Gregory,</p>
      <p>Votre compte est maintenant en accès <strong>PREMIUM</strong>. Profitez de toutes les fonctionnalités sans limite.</p>
      <ul style="color:#8fa3bf;padding-left:20px;line-height:1.8;">
        <li>✅ Trades illimités</li>
        <li>✅ Analytics avancés (par setup, émotion, heure)</li>
        <li>✅ IA Insights &amp; Chat Coach</li>
        <li>✅ Weekly Debrief automatique</li>
        <li>✅ Score Trader &amp; Export PDF</li>
      </ul>
      <a href="${appUrl}" style="${BTN_STYLE}">
        Accéder à mon tableau de bord →
      </a>
    </div>

    <div style="${CARD_STYLE}">
      <p style="margin:0 0 8px 0;">👥 <strong>Accède au salon ⭐ Premium sur Discord</strong></p>
      <p style="color:#8fa3bf;margin:0 0 12px 0;">
        Réservé aux membres Premium — stratégies avancées, support prioritaire et échanges exclusifs.
      </p>
      <a href="https://discord.gg/zSPD9pv4eB" style="${BTN_STYLE}">
        Rejoindre le Discord →
      </a>
      <p style="color:#8fa3bf;font-size:12px;margin-top:12px;">
        Tape <code>/verify</code> dans #👋-bienvenue pour débloquer ton accès Premium.
      </p>
    </div>

    <p style="${MUTED_STYLE}">MyTradingCoach — Fait en France 🇫🇷</p>
  </div>
`;

const { data, error } = await resend.emails.send({
  from: `MyTradingCoach <${env.MAIL_FROM || 'noreply@mytradingcoach.app'}>`,
  to: 'tahir.gregory@gmail.com',
  subject: '🚀 Bienvenue dans MyTradingCoach PREMIUM !',
  html,
  replyTo: env.MAIL_SAV || 'support@mytradingcoach.app',
});

if (error) {
  console.error('❌ Erreur :', error.message);
  process.exit(1);
}

console.log('✅ Email envoyé — id:', data.id);
