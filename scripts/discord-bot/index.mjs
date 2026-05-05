import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';

const ROLE_MEMBRE  = process.env.DISCORD_ROLE_MEMBRE_ID;
const ROLE_PREMIUM = process.env.DISCORD_ROLE_PREMIUM_ID;
const API_URL      = process.env.API_URL ?? 'https://api.mytradingcoach.app';
const BOT_SECRET   = process.env.DISCORD_BOT_SECRET;

const REQUIRED_ENV = ['DISCORD_BOT_TOKEN', 'DISCORD_BOT_SECRET', 'DISCORD_ROLE_MEMBRE_ID', 'DISCORD_ROLE_PREMIUM_ID'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[Bot] Variables d'environnement manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.on('error', (err) => {
  console.error('[Bot] Erreur client Discord :', err.message);
});

// DM de bienvenue automatique
client.on('guildMemberAdd', async (member) => {
  try {
    await member.send(
      '👋 Bienvenue sur le Discord MyTradingCoach !\n\n' +
      'Pour accéder aux salons, vérifie ton compte :\n' +
      'Tape dans **#👋-bienvenue** :\n' +
      '```/verify email:ton@email.com```\n' +
      'Ton rôle sera attribué automatiquement.\n\n' +
      '➡️ Pas encore inscrit ? https://app.mytradingcoach.app/register',
    );
  } catch {
    // DM désactivés par l'utilisateur — on ignore silencieusement
  }
});

// Commande /verify
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify') return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return; // interaction expirée (bot redémarré entre-temps) — on ignore
  }

  const email     = interaction.options.getString('email');
  const discordId = interaction.user.id;

  if (!email) {
    await interaction.editReply({ content: '❌ Adresse email manquante.' });
    return;
  }

  let data;
  try {
    const res = await fetch(
      `${API_URL}/api/discord/verify?email=${encodeURIComponent(email)}&discordId=${discordId}`,
      { headers: { 'x-discord-secret': BOT_SECRET } },
    );

    if (!res.ok && res.status === 401) {
      console.error(`[Bot] /verify — 401 Unauthorized (DISCORD_BOT_SECRET incorrect ou manquant)`);
      await interaction.editReply({ content: '❌ Erreur de configuration du bot. Contacte un administrateur.' });
      return;
    }

    data = await res.json();
  } catch (err) {
    console.error(`[Bot] /verify — Impossible de joindre l'API (${API_URL}) :`, err);
    await interaction.editReply({ content: '❌ Erreur de connexion. Réessaie dans quelques instants.' });
    return;
  }

  if (!data.data?.verified) {
    await interaction.editReply({ content: '❌ ' + (data.data?.message ?? 'Erreur inconnue') });
    return;
  }

  const member = interaction.member;
  await member.roles.remove([ROLE_MEMBRE, ROLE_PREMIUM].filter(Boolean)).catch(() => undefined);

  if (data.data.plan === 'PREMIUM') {
    await member.roles.add(ROLE_PREMIUM);
    await interaction.editReply({
      content:
        `✅ Vérifié **${data.data.name}** ! 🎉\n` +
        `Rôle ⭐ Premium attribué — salon Premium débloqué.`,
    });
  } else {
    await member.roles.add(ROLE_MEMBRE);
    await interaction.editReply({
      content:
        `✅ Vérifié **${data.data.name}** ! 👋\n` +
        `Rôle 👋 Membre attribué.\n` +
        `💡 Passe à Premium → https://app.mytradingcoach.app/settings`,
    });
  }
});

client.once('clientReady', async () => {
  console.log(`[Bot] Connecté en tant que ${client.user?.tag}`);
  console.log(`[Bot] API cible : ${API_URL}`);

  // Vérification de connectivité API au démarrage
  try {
    const res = await fetch(`${API_URL}/api/health`);
    if (res.ok) {
      console.log('[Bot] API health check OK');
    } else {
      console.warn(`[Bot] API health check — statut inattendu : ${res.status}`);
    }
  } catch (err) {
    console.error(`[Bot] ATTENTION : impossible de joindre l'API (${API_URL}) au démarrage :`, err.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
