#!/usr/bin/env node
/**
 * send-discord-invite.mjs
 * Usage :
 *   node scripts/send-discord-invite.mjs              → dry-run
 *   node scripts/send-discord-invite.mjs --send       → envoi réel
 *   node scripts/send-discord-invite.mjs --send --to=email@test.com
 */

import { Resend } from 'resend';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args      = process.argv.slice(2);
const DRY_RUN   = !args.includes('--send');
const TEST_TO   = args.find(a => a.startsWith('--to='))?.split('=')[1];

// Charger .env
const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);

const DISCORD_URL = 'https://discord.gg/TDK2npvkSN';
const APP_URL     = env.FRONTEND_URL || 'https://app.mytradingcoach.app';
const MAIL_FROM   = env.MAIL_FROM    || 'MyTradingCoach <noreply@mytradingcoach.app>';
const MAIL_SAV    = env.MAIL_SAV     || 'support@mytradingcoach.app';

// Connexion BDD
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();

const { rows: users } = await client.query(`
  SELECT id, email, name
  FROM "User"
  WHERE "discordId" IS NULL
    AND email IS NOT NULL
  ORDER BY "createdAt" ASC
`);
await client.end();

console.log(`\n📊 Users sans Discord : ${users.length}`);

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN — aucun email envoyé. Utilise --send pour envoyer.\n');
  users.forEach((u, i) => console.log(`  ${i+1}. ${u.email} — ${u.name ?? '(sans nom)'}`));
  console.log(`\nPour envoyer : node scripts/send-discord-invite.mjs --send\n`);
  process.exit(0);
}

const targets = TEST_TO ? [{ email: TEST_TO, name: 'Test' }] : users;

if (!targets.length) {
  console.log('✅ Tous les utilisateurs ont déjà lié leur Discord.');
  process.exit(0);
}

function buildHtml(userName) {
  const name = userName || 'Trader';
  return `
<div style="font-family:'DM Sans',Arial,sans-serif;background:#080c14;color:#e2eaf5;max-width:600px;margin:0 auto;padding:40px 24px;">

  <h1 style="color:#e2eaf5;font-size:22px;margin-bottom:6px;">💬 Tu n'es pas encore sur notre Discord !</h1>
  <p style="color:#8fa3bf;margin-top:0;">MyTradingCoach — Communauté</p>

  <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:12px;padding:28px;margin:20px 0;">
    <p style="margin-top:0;">Bonjour ${name},</p>
    <p style="color:#b0bec5;line-height:1.7;">
      On vient de voir que tu n'as pas encore rejoint notre communauté Discord.
      C'est là où se passent les vraies discussions — setups ICT/SMC, partage de trades, support direct.
    </p>
    <p style="color:#b0bec5;line-height:1.7;margin-bottom:20px;">Ça prend 2 minutes et c'est gratuit.</p>

    <a href="${DISCORD_URL}" style="display:inline-block;background:#5865f2;color:white;text-decoration:none;padding:13px 28px;border-radius:9px;font-weight:700;font-size:15px;margin-bottom:20px;">
      Rejoindre le Discord →
    </a>

    <div style="background:#080c14;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="color:#8fa3bf;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 10px;">Ce qui t'attend</p>
      <div style="color:#b0bec5;font-size:13px;line-height:2.2;">
        📊 <strong style="color:#e2eaf5;">#partage-trades</strong> — Montre tes setups, reçois des retours<br/>
        🏆 <strong style="color:#e2eaf5;">#wins-de-la-semaine</strong> — Célèbre tes meilleures semaines<br/>
        📅 <strong style="color:#e2eaf5;">#weekly-debrief</strong> — Discute les analyses de l'IA<br/>
        💡 <strong style="color:#e2eaf5;">#idées-features</strong> — Influence le développement<br/>
        🎫 <strong style="color:#e2eaf5;">Support direct</strong> — Réponse rapide si tu as un problème
      </div>
    </div>

    <div style="background:#0a1628;border:1px solid rgba(88,101,242,0.2);border-radius:8px;padding:12px 14px;">
      <p style="color:#8fa3bf;font-size:12px;margin:0;line-height:1.8;">
        📌 Une fois sur le serveur, tape
        <code style="background:#1e2533;padding:2px 7px;border-radius:4px;color:#00d4aa;font-family:monospace;">/verify</code>
        dans <strong style="color:#e2eaf5;">#👋-bienvenue</strong>
        avec ton email MyTradingCoach pour obtenir ton rôle <strong style="color:#00d4aa;">Membre</strong> automatiquement.<br/><br/>
        Si tu passes en Premium, ton rôle Discord passera à <strong style="color:#f59e0b;">Premium</strong> automatiquement.
      </p>
    </div>
  </div>

  <div style="background:#0f1824;border:1px solid rgba(99,155,255,.1);border-radius:12px;padding:20px;margin:20px 0;">
    <p style="margin:0 0 10px;color:#e2eaf5;font-size:13px;">Et si ce n'est pas encore fait, ton journal t'attend 📖</p>
    <a href="${APP_URL}" style="display:inline-block;background:#1e3a5f;color:#60a5fa;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;border:1px solid rgba(96,165,250,0.2);">
      Accéder à mon journal →
    </a>
  </div>

  <p style="color:#8fa3bf;font-size:12px;margin-top:28px;text-align:center;">
    MyTradingCoach — Fait en France 🇫🇷
  </p>
</div>`;
}

const resend = new Resend(env.RESEND_API_KEY);
console.log(`\n🚀 Envoi à ${targets.length} utilisateur(s)...\n`);

let success = 0, errors = 0;

for (const user of targets) {
  try {
    const { data, error } = await resend.emails.send({
      from:    MAIL_FROM,
      to:      user.email,
      subject: '💬 Rejoins la communauté Discord MyTradingCoach',
      html:    buildHtml(user.name),
      replyTo: MAIL_SAV,
    });
    if (error) { console.error(`  ❌ ${user.email} — ${error.message}`); errors++; }
    else        { console.log(`  ✅ ${user.email} — id: ${data.id}`); success++; }
    await new Promise(r => setTimeout(r, 200));
  } catch (err) {
    console.error(`  ❌ ${user.email} — ${err.message}`);
    errors++;
  }
}

console.log(`\n📊 Résultat : ${success} envoyés, ${errors} erreurs\n`);
