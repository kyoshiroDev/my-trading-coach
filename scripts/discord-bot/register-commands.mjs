import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Vérifie ton compte MyTradingCoach et obtiens ton rôle')
    .addStringOption((o) =>
      o
        .setName('email')
        .setDescription('Ton adresse email MyTradingCoach')
        .setRequired(true),
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

await rest.put(
  Routes.applicationGuildCommands(
    process.env.DISCORD_CLIENT_ID,
    process.env.DISCORD_GUILD_ID,
  ),
  { body: commands },
);

console.log('✅ Commande /verify enregistrée sur le serveur Discord');
