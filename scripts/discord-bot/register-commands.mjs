import { REST, Routes, SlashCommandBuilder } from 'discord.js';

/**
 * Enregistre la commande /verify sur le serveur. À lancer DANS le conteneur du bot, qui a déjà
 * DISCORD_BOT_TOKEN dans son environnement (le jeton ne sort jamais du serveur) :
 *   docker exec -e DISCORD_GUILD_ID=<id du serveur> mtc_discord_bot node register-commands.mjs
 * DISCORD_CLIENT_ID est facultatif : sans lui, l'identifiant de l'application est lu avec le jeton.
 */
const commands = [
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Relie ton compte MyTradingCoach avec le code affiché dans ton Profil')
    .addStringOption((o) =>
      o
        .setName('code')
        .setDescription('Code à 8 caractères (Profil, onglet Paramètres, bloc Discord)')
        .setRequired(true)
        .setMaxLength(16),
    ),
].map((c) => c.toJSON());

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) {
  console.error('DISCORD_BOT_TOKEN et DISCORD_GUILD_ID sont requis.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);
const clientId = process.env.DISCORD_CLIENT_ID ?? (await rest.get(Routes.currentApplication())).id;

await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

console.log('✅ Commande /verify code: enregistrée sur le serveur Discord');
