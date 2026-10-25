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

// Empêche Node 22 de crasher sur une rejection non catchée
process.on('unhandledRejection', (err) => {
  console.error('[Bot] Unhandled rejection (process protégé) :', err?.message ?? err);
});

// Où l'utilisateur génère son code de liaison (#741).
const LINK_PAGE = 'https://app.mytradingcoach.app/profil?tab=params';
const HOW_TO_LINK =
  `Génère ton code dans l'app (Profil, onglet Paramètres, bloc Discord) : ${LINK_PAGE}\n` +
  'puis tape ici : ```/verify code:XXXX-XXXX```';

// DM de bienvenue automatique
client.on('guildMemberAdd', async (member) => {
  try {
    await member.send(
      '👋 Bienvenue sur le Discord MyTradingCoach !\n\n' +
      'Pour accéder aux salons, relie ton compte :\n' +
      HOW_TO_LINK + '\n' +
      'Ton rôle sera attribué automatiquement.\n\n' +
      '➡️ Pas encore inscrit ? https://app.mytradingcoach.app/register',
    );
  } catch {
    // DM désactivés par l'utilisateur — on ignore silencieusement
  }
});

// Commande /verify code: (#741). Le code prouve que la personne est connectée au compte : un
// e-mail tapé ne prouvait rien.
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify') return;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return; // interaction expirée (bot redémarré entre-temps) — on ignore
  }

  // Tant que la commande n'est pas réenregistrée, Discord envoie encore l'option « email » :
  // `code` est alors vide et on explique la nouvelle marche à suivre.
  const code      = interaction.options.getString('code');
  const discordId = interaction.user.id;

  if (!code) {
    await interaction.editReply({ content: 'ℹ️ La vérification par e-mail n\'existe plus.\n' + HOW_TO_LINK });
    return;
  }

  let data;
  try {
    const res = await fetch(`${API_URL}/api/discord/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-discord-secret': BOT_SECRET },
      body: JSON.stringify({ code, discordId }),
    });

    if (res.status === 401) {
      console.error(`[Bot] /verify — 401 Unauthorized (DISCORD_BOT_SECRET incorrect ou manquant)`);
      await interaction.editReply({ content: '❌ Erreur de configuration du bot. Contacte un administrateur.' });
      return;
    }
    if (res.status === 400) {
      await interaction.editReply({ content: '❌ Code invalide ou expiré.\n' + HOW_TO_LINK });
      return;
    }

    data = await res.json();
  } catch (err) {
    console.error(`[Bot] /verify — Impossible de joindre l'API (${API_URL}) :`, err);
    await interaction.editReply({ content: '❌ Erreur de connexion. Réessaie dans quelques instants.' });
    return;
  }

  if (!data.data?.linked) {
    await interaction.editReply({ content: '❌ ' + (data.data?.message ?? 'Erreur inconnue') });
    return;
  }

  const member = interaction.member;
  await member.roles.remove([ROLE_MEMBRE, ROLE_PREMIUM].filter(Boolean)).catch(() => undefined);

  try {
    if (data.data.plan === 'PREMIUM') {
      await member.roles.add(ROLE_PREMIUM);
      await interaction.editReply({
        content: '✅ Compte relié ! 🎉\nRôle ⭐ Premium attribué : salon Premium débloqué.',
      });
    } else {
      await member.roles.add(ROLE_MEMBRE);
      await interaction.editReply({
        content:
          '✅ Compte relié ! 👋\n' +
          'Rôle 👋 Membre attribué.\n' +
          `💡 Passe à Premium : ${LINK_PAGE}`,
      });
    }
  } catch (err) {
    console.error(`[Bot] /verify — Impossible d'attribuer le rôle (${err.message}) — vérifier : 1) permission "Gérer les rôles" activée, 2) rôle du bot au-dessus des rôles Membre/Premium dans la hiérarchie`);
    await interaction.editReply({
      content: "✅ Compte relié !\n⚠️ Impossible d'attribuer le rôle automatiquement : contacte un administrateur.",
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
