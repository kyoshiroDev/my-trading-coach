import { Client, GatewayIntentBits } from 'discord.js';

const ROLE_MEMBRE  = process.env.DISCORD_ROLE_MEMBRE_ID;
const ROLE_PREMIUM = process.env.DISCORD_ROLE_PREMIUM_ID;
const API_URL      = process.env.API_URL ?? 'https://api.mytradingcoach.app';
const BOT_SECRET   = process.env.DISCORD_BOT_SECRET;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// DM de bienvenue automatique
client.on('guildMemberAdd', async (member) => {
  try {
    await member.send(
      '👋 Bienvenue sur le Discord MyTradingCoach !\n\n' +
      'Pour accéder aux salons, vérifie ton compte :\n' +
      'Tape dans **#verification** :\n' +
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

  await interaction.deferReply({ ephemeral: true });

  const email     = interaction.options.getString('email');
  const discordId = interaction.user.id;

  try {
    const res = await fetch(
      `${API_URL}/api/discord/verify?email=${encodeURIComponent(email)}&discordId=${discordId}`,
      { headers: { 'x-discord-secret': BOT_SECRET } },
    );
    const data = await res.json();

    if (!data.data?.verified) {
      await interaction.editReply({ content: '❌ ' + (data.data?.message ?? 'Erreur inconnue') });
      return;
    }

    const member = interaction.member;
    await member.roles.remove([ROLE_MEMBRE, ROLE_PREMIUM].filter(Boolean)).catch(() => {});

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
  } catch {
    await interaction.editReply({ content: '❌ Erreur de connexion. Réessaie dans quelques instants.' });
  }
});

client.once('ready', () => {
  console.log(`[Bot] Connecté en tant que ${client.user?.tag}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
